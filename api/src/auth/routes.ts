import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withService } from '../db/context.js';
import { z } from 'zod';
import { sendError } from '../http/errors.js';
import { hit, normalizeEmail } from './rate-limit.js';
import { revokeSession } from './sessions.js';
import { changePassword, login, requestReset, resendConfirmation, resetPassword, signup, verifyEmail } from './service.js';

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

const INVALID = '요청 형식이 올바르지 않습니다.';

function clientIp(req: FastifyRequest): string {
  const h = req.headers['x-bara-client-ip'];
  const v = typeof h === 'string' ? h.trim().slice(0, 64) : '';
  return v || req.ip;
}

export function registerAuthRoutes(app: FastifyInstance): void {
  const onMailError = (err: unknown) => app.log.error({ errorName: err instanceof Error ? err.name : 'unknown' }, 'auth mail failed');
  const originAllowed = (origin: string) => app.deps.config.siteOrigins.includes(origin);

  app.post('/v1/auth/signup', async (req, reply) => {
    const body = signupBody.safeParse(req.body);
    if (!body.success || !originAllowed(body.data.origin)) return sendError(reply, 'validation', INVALID);
    if (!(await hit(app.deps.pool, 'signup', clientIp(req), 10, 3600))) {
      return sendError(reply, 'rate_limited', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    }
    return { status: await signup(app.deps.pool, app.deps.mailer, body.data, onMailError) };
  });

  app.post('/v1/auth/resend', async (req, reply) => {
    const body = resendBody.safeParse(req.body);
    if (!body.success || !originAllowed(body.data.origin)) return sendError(reply, 'validation', INVALID);
    const { pool, mailer } = app.deps;
    const { email: to, origin } = body.data;
    const allowed = (await hit(pool, 'resend-60s', to, 1, 60)) && (await hit(pool, 'resend-1h', to, 4, 3600));
    if (allowed) await resendConfirmation(pool, mailer, to, origin, onMailError);
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
    const r = await login(app.deps.pool, app.deps.config.sessionTtlDays, body.data.email, body.data.password);
    if (r.kind === 'rate_limited') return sendError(reply, 'rate_limited', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    if (r.kind === 'fail') return sendError(reply, 'unauthenticated', r.detail);
    return { sessionToken: r.sessionToken, expiresAt: r.expiresAt, userId: r.userId };
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    if (!req.auth.userId) return sendError(reply, 'unauthenticated', '로그인이 필요합니다.');
    await revokeSession(app.deps.pool, String(req.headers['x-bara-session']));
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
    const { pool, mailer } = app.deps;
    const { email: to, origin } = body.data;
    const allowed = (await hit(pool, 'reset-60s', to, 1, 60)) && (await hit(pool, 'reset-1h', to, 4, 3600));
    if (allowed) await requestReset(pool, mailer, to, origin, onMailError);
    return { ok: true };
  });

  app.post('/v1/auth/reset-password', async (req, reply) => {
    const body = resetBody.safeParse(req.body);
    if (!body.success) return sendError(reply, 'validation', INVALID);
    if (!(await resetPassword(app.deps.pool, body.data.token, body.data.newPassword))) return sendError(reply, 'validation', 'invalid_token');
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
    };
  });
}
