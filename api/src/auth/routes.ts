import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withService, withUser } from '../db/context.js';
import { z } from 'zod';
import { sendError } from '../http/errors.js';
import { hit, normalizeEmail } from './rate-limit.js';
import { revokeAllSessions, revokeSession } from './sessions.js';
import type { MailMessage } from '../mail/mailer.js';
import { withdrawAccount } from './withdraw.js';
import { changePassword, confirmEmailAsAdmin, listConfirmations, login, requestReset, resendConfirmation, resetPassword, sendResetAsAdmin, signup, verifyEmail } from './service.js';

type SessionRow = {
  id: string;
  email: string;
  email_confirmed_at: Date | null;
  role: string | null;
  status: string | null;
};

const email = z.string().trim().min(1).max(254).email().transform(normalizeEmail);

const signupBody = z.object({
  email,
  password: z.string().min(8).max(200),
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(30).nullish(),
  origin: z.string(),
});
const resendBody = z.object({ email, origin: z.string() });
const verifyBody = z.object({ token: z.string().min(1).max(200) });

const loginBody = z.object({ email, password: z.string().min(1).max(200) });
const changeBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(8).max(200) });
const resetBody = z.object({ token: z.string().min(1).max(200), newPassword: z.string().min(8).max(200) });

const withdrawBody = z
  .object({ reason: z.string().regex(/^[a-z_]{1,50}$/), detail: z.string().max(1000).nullish() })
  .strict();
const sendResetBody = z.object({ origin: z.string() });
const idParam = z.object({ id: z.string().uuid() });

const INVALID = '요청 형식이 올바르지 않습니다.';

// request.ip would be the app's own egress address (shared by all users), so without the header IP limits are skipped
function clientIp(req: FastifyRequest): string | null {
  const h = req.headers['x-bara-client-ip'];
  const v = typeof h === 'string' ? h.trim().slice(0, 64) : '';
  return v || null;
}

export function registerAuthRoutes(app: FastifyInstance): void {
  const onMailError = (err: unknown) => app.log.error({ errorName: err instanceof Error ? err.name : 'unknown' }, 'auth mail failed');
  const deliver = (msg: MailMessage) => {
    setImmediate(() => {
      app.deps.mailer.send(msg).catch(onMailError);
    });
  };
  const tooMany = (reply: FastifyReply) => sendError(reply, 'rate_limited', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  // true when this request's IP is over the limit; requests without a client IP are not IP-limited
  const ipLimited = async (req: FastifyRequest, bucket: string, limit: number, windowSeconds: number) => {
    const ip = clientIp(req);
    return ip !== null && !(await hit(app.deps.pool, bucket, ip, limit, windowSeconds));
  };
  const originAllowed = (origin: string) => app.deps.config.siteOrigins.includes(origin);

  app.post('/v1/auth/signup', async (req, reply) => {
    const body = signupBody.safeParse(req.body);
    if (!body.success || !originAllowed(body.data.origin)) return sendError(reply, 'validation', INVALID);
    if (await ipLimited(req, 'signup', 10, 3600)) return tooMany(reply);
    return { status: await signup(app.deps.pool, deliver, body.data) };
  });

  app.post('/v1/auth/resend', async (req, reply) => {
    const body = resendBody.safeParse(req.body);
    if (!body.success || !originAllowed(body.data.origin)) return sendError(reply, 'validation', INVALID);
    const { pool } = app.deps;
    const { email: to, origin } = body.data;
    if (await ipLimited(req, 'resend-ip', 20, 3600)) return tooMany(reply);
    const allowed = (await hit(pool, 'resend-60s', to, 1, 60)) && (await hit(pool, 'resend-1h', to, 4, 3600));
    if (allowed) await resendConfirmation(pool, deliver, to, origin);
    return { status: 'pending_confirmation' };
  });

  app.post('/v1/auth/verify-email', async (req, reply) => {
    const body = verifyBody.safeParse(req.body);
    if (!body.success) return sendError(reply, 'validation', 'invalid_token');
    const { pool, config } = app.deps;
    const r = await verifyEmail(pool, config.sessionTtlDays, body.data.token);
    if (!r) return sendError(reply, 'validation', 'invalid_token');
    return { sessionToken: r.sessionToken, expiresAt: r.expiresAt };
  });

  app.post('/v1/auth/login', async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return sendError(reply, 'validation', INVALID);
    if (await ipLimited(req, 'login-ip', 50, 900)) return tooMany(reply);
    const r = await login(app.deps.pool, app.deps.config.sessionTtlDays, body.data.email, body.data.password);
    if (r.kind === 'rate_limited') return tooMany(reply);
    if (r.kind === 'fail') return sendError(reply, 'unauthenticated', r.detail);
    return { sessionToken: r.sessionToken, expiresAt: r.expiresAt, userId: r.userId };
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    if (!req.auth.userId) return sendError(reply, 'unauthenticated', '로그인이 필요합니다.');
    await revokeSession(app.deps.pool, String(req.headers['x-bara-session']));
    return { ok: true };
  });

  app.post('/v1/auth/logout-all', async (req, reply) => {
    const userId = req.auth.userId;
    if (!userId) return sendError(reply, 'unauthenticated', '로그인이 필요합니다.');
    await revokeAllSessions(app.deps.pool, userId);
    return { ok: true };
  });

  app.post('/v1/auth/change-password', async (req, reply) => {
    const userId = req.auth.userId;
    if (!userId) return sendError(reply, 'unauthenticated', '로그인이 필요합니다.');
    const body = changeBody.safeParse(req.body);
    if (!body.success) return sendError(reply, 'validation', INVALID);
    const ok = await changePassword(app.deps.pool, userId, String(req.headers['x-bara-session']), body.data.currentPassword, body.data.newPassword);
    if (!ok) return sendError(reply, 'forbidden', '현재 비밀번호가 올바르지 않습니다.');
    return { ok: true };
  });

  app.post('/v1/auth/request-reset', async (req, reply) => {
    const body = resendBody.safeParse(req.body);
    if (!body.success || !originAllowed(body.data.origin)) return sendError(reply, 'validation', INVALID);
    const { pool } = app.deps;
    const { email: to, origin } = body.data;
    if (await ipLimited(req, 'reset-ip', 20, 3600)) return tooMany(reply);
    const allowed = (await hit(pool, 'reset-60s', to, 1, 60)) && (await hit(pool, 'reset-1h', to, 4, 3600));
    if (allowed) await requestReset(pool, deliver, to, origin);
    return { ok: true };
  });

  app.post('/v1/auth/reset-password', async (req, reply) => {
    const body = resetBody.safeParse(req.body);
    if (!body.success) return sendError(reply, 'validation', INVALID);
    if (!(await resetPassword(app.deps.pool, body.data.token, body.data.newPassword))) return sendError(reply, 'validation', 'invalid_token');
    return { ok: true };
  });

  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const userId = req.auth.userId;
    if (!userId) {
      sendError(reply, 'unauthenticated', '로그인이 필요합니다.');
      return false;
    }
    const r = await withUser(app.deps.pool, userId, (tx) => tx.query<{ ok: boolean | null }>('select public.is_admin() as ok'));
    if (r.rows[0]?.ok !== true) {
      sendError(reply, 'forbidden', '관리자 권한이 필요합니다.');
      return false;
    }
    return true;
  };

  app.post('/v1/admin/users/:id/confirm-email', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return reply;
    const params = idParam.safeParse(req.params);
    if (!params.success) return sendError(reply, 'validation', INVALID);
    if (!(await confirmEmailAsAdmin(app.deps.pool, params.data.id))) return sendError(reply, 'not_found', '회원을 찾을 수 없습니다.');
    return { ok: true };
  });

  app.post('/v1/admin/users/:id/send-reset', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return reply;
    const params = idParam.safeParse(req.params);
    const body = sendResetBody.safeParse(req.body);
    if (!params.success || !body.success || !originAllowed(body.data.origin)) return sendError(reply, 'validation', INVALID);
    const r = await sendResetAsAdmin(app.deps.pool, deliver, params.data.id, body.data.origin);
    if (r === 'not_found') return sendError(reply, 'not_found', '회원을 찾을 수 없습니다.');
    return { ok: true, mailSent: true };
  });

  app.get('/v1/admin/users/confirmations', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return reply;
    return { items: await listConfirmations(app.deps.pool) };
  });

  app.post('/v1/account/withdraw', async (req, reply) => {
    const userId = req.auth.userId;
    if (!userId) return sendError(reply, 'unauthenticated', '로그인이 필요합니다.');
    const body = withdrawBody.safeParse(req.body);
    if (!body.success) return sendError(reply, 'validation', INVALID);
    const r = await withdrawAccount(app.deps.pool, userId, { reason: body.data.reason, detail: body.data.detail?.trim() || null });
    if (r === 'active_enrollment') return sendError(reply, 'conflict', 'active_enrollment');
    if (r === 'not_found') return sendError(reply, 'not_found', '회원을 찾을 수 없습니다.');
    // DB가 커밋된 뒤에만 사진을 지운다. 실패해도 탈퇴는 성공(photo_path는 이미 비워져 조회 경로가 없고, 남은 파일은 운영 정리 대상).
    // 키는 DB 트리거가 `<uid>/photo`로 고정하므로 photo_path 값과 무관하게 항상 지운다.
    try {
      await app.deps.storage.remove(`${userId}/photo`);
    } catch (err) {
      req.log.error({ errorName: err instanceof Error ? err.name : 'unknown' }, 'withdraw photo removal failed');
    }
    return { ok: true };
  });

  app.get('/v1/auth/session', async (req, reply) => {
    const userId = req.auth.userId;
    if (!userId) return sendError(reply, 'unauthenticated', '로그인이 필요합니다.');
    const r = await withService(app.deps.pool, (tx) =>
      tx.query<SessionRow>(
        `select u.id, u.email, u.email_confirmed_at, p.role, p.status
           from auth.users u left join public.profiles p on p.id = u.id
          where u.id = $1`,
        [userId],
      ),
    );
    if (r.rowCount === 0) return sendError(reply, 'unauthenticated', '로그인이 필요합니다.');
    const row = r.rows[0];
    return {
      user: { id: row.id, email: row.email, emailConfirmedAt: row.email_confirmed_at },
      profile: row.role && row.status ? { role: row.role, status: row.status } : null,
      // 슬라이딩 만료(resolveSession)가 반영된 값 — 앱 proxy가 브라우저 쿠키 만료를 맞추는 데 쓴다
      expiresAt: req.auth.sessionExpiresAt,
    };
  });
}
