import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isIP } from 'node:net';
import { z } from 'zod';
import { withUser } from '../db/context.js';
import { sendError } from '../http/errors.js';
import {
  ackRecoveryCodes,
  ADMIN_RESET_REASONS,
  adminGetMfa,
  adminMfaOverview,
  adminResetMfa,
  checkEnrollTicket,
  confirmEnrollment,
  currentEnrollment,
  LogFailed,
  mfaStatus,
  MfaUnavailable,
  recoverMfa,
  regenerateRecoveryCodes,
  startEnrollment,
  verifyMfa,
  type Fail,
  type MfaDeps,
} from './mfa.js';
import { hit, rateKeyForIp } from './rate-limit.js';
import { normalizeTotpInput } from './totp.js';
import type { MailMessage } from '../mail/mailer.js';

// 관리자 2단계 인증 엔드포인트(기획서 4.2~4.6). 비밀 값(대기표·6자리·복구 코드·등록 코드)은 본문으로만 받고 본문으로만 돌려준다.
// 실패 코드는 기존 code 값만 쓰고 앱은 message로 분기한다(4.0).

const INVALID = '요청 형식이 올바르지 않습니다.';
const NEED_LOGIN = '로그인이 필요합니다.';
const IP_BUCKET = 'mfa-ip';
const IP_LIMIT = 50;
const IP_WINDOW = 15 * 60;

const challengeToken = z.string().min(1).max(200);
const idParam = z.object({ id: z.string().uuid() });

const NO_STORE_PATHS = [/^\/v1\/auth\/mfa\//, /^\/v1\/auth\/login$/, /^\/v1\/admin\/users\/[^/]+\/mfa/, /^\/v1\/admin\/mfa\//];

function clientIp(req: FastifyRequest): string | null {
  const h = req.headers['x-bara-client-ip'];
  const v = typeof h === 'string' ? h.trim().slice(0, 64) : '';
  return v || null;
}

const bodyOf = (req: FastifyRequest): Record<string, unknown> => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {});

export function registerMfaRoutes(app: FastifyInstance, deliver: (msg: MailMessage) => void): void {
  const deps = (req: FastifyRequest): MfaDeps => ({
    pool: app.deps.pool,
    keyring: app.deps.config.mfa.keyring,
    mode: app.deps.config.mfa.mode,
    alertTo: app.deps.config.mfa.alertTo,
    ttlDays: app.deps.config.sessionTtlDays,
    deliver,
    log: req.log,
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const path = req.url.split('?')[0];
    if (NO_STORE_PATHS.some((re) => re.test(path))) reply.header('cache-control', 'no-store');
    return payload;
  });

  const sendFail = (reply: FastifyReply, f: Fail) => sendError(reply, f.code, f.message, f.field, f.extra);
  const isFail = (x: unknown): x is Fail => typeof x === 'object' && x !== null && (x as { kind?: unknown }).kind === 'fail';
  const bad = (reply: FastifyReply, field: string) => sendError(reply, 'validation', INVALID, field);

  // MfaUnavailable(키 없음·복호화 실패) -> 503 unavailable, LogFailed(접속 기록 실패, 전체 롤백) -> 503 log_failed
  const run = async (req: FastifyRequest, reply: FastifyReply, fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof LogFailed) return sendError(reply, 'unavailable', 'log_failed');
      if (err instanceof MfaUnavailable) {
        req.log.error({ event: 'mfa_unavailable', reason: err.message }, 'mfa unavailable');
        return sendError(reply, 'unavailable', 'unavailable');
      }
      throw err;
    }
  };

  const ipKeyOf = (req: FastifyRequest) => {
    const ip = clientIp(req);
    return ip === null ? null : rateKeyForIp(ip);
  };
  const ipLimited = async (req: FastifyRequest) => {
    const key = ipKeyOf(req);
    return key !== null && !(await hit(app.deps.pool, IP_BUCKET, key, IP_LIMIT, IP_WINDOW));
  };
  const tooMany = (reply: FastifyReply) => sendError(reply, 'rate_limited', 'rate_limited');
  const logIp = (req: FastifyRequest) => {
    const ip = clientIp(req);
    return ip !== null && isIP(ip) ? ip : null;
  };

  // 세션 사용자가 관리자인지(RLS의 is_admin과 같은 기준)
  const isAdmin = async (userId: string) =>
    (await withUser(app.deps.pool, userId, (tx) => tx.query<{ ok: boolean | null }>('select public.is_admin() as ok'))).rows[0]?.ok === true;

  const respond = (reply: FastifyReply, out: unknown, ok: (v: any) => unknown) => (isFail(out) ? sendFail(reply, out) : ok(out));
  const sessionBody = (s: { sessionToken: string; expiresAt: Date; userId: string }) => ({ sessionToken: s.sessionToken, expiresAt: s.expiresAt, userId: s.userId });

  // 4.2
  app.post('/v1/auth/mfa/verify', async (req, reply) => {
    const b = bodyOf(req);
    const t = challengeToken.safeParse(b.challengeToken);
    if (!t.success) return bad(reply, 'challengeToken');
    const code = typeof b.code === 'string' && b.code.length <= 20 ? normalizeTotpInput(b.code) : null;
    if (code === null) return bad(reply, 'code');
    if (await ipLimited(req)) return tooMany(reply);
    return run(req, reply, async () => respond(reply, await verifyMfa(deps(req), { challengeToken: t.data, code, ip: logIp(req), ipKey: ipKeyOf(req) }), sessionBody));
  });

  // 4.3
  app.post('/v1/auth/mfa/recover', async (req, reply) => {
    const b = bodyOf(req);
    const t = challengeToken.safeParse(b.challengeToken);
    if (!t.success) return bad(reply, 'challengeToken');
    if (typeof b.recoveryCode !== 'string' || b.recoveryCode.length < 1 || b.recoveryCode.length > 40) return bad(reply, 'recoveryCode');
    if (await ipLimited(req)) return tooMany(reply);
    const recoveryCode = b.recoveryCode;
    return run(req, reply, async () =>
      respond(reply, await recoverMfa(deps(req), { challengeToken: t.data, recoveryCode, ip: logIp(req), ipKey: ipKeyOf(req) }), (s) => ({ ...sessionBody(s), recoveryCodesLeft: s.recoveryCodesLeft })),
    );
  });

  // 4.4.1
  app.post('/v1/auth/mfa/enroll/ticket', async (req, reply) => {
    const b = bodyOf(req);
    const t = challengeToken.safeParse(b.challengeToken);
    if (!t.success) return bad(reply, 'challengeToken');
    const ticket = typeof b.enrollTicket === 'string' && b.enrollTicket.length <= 40 ? b.enrollTicket.replace(/\s/g, '') : '';
    if (!/^[0-9]{8}$/.test(ticket)) return bad(reply, 'enrollTicket');
    if (await ipLimited(req)) return tooMany(reply);
    return run(req, reply, async () => respond(reply, await checkEnrollTicket(deps(req), { challengeToken: t.data, enrollTicket: ticket, ipKey: ipKeyOf(req) }), () => ({ ok: true })));
  });

  // 4.4.2
  app.post('/v1/auth/mfa/enroll/start', async (req, reply) => {
    const b = bodyOf(req);
    if (b.renew !== undefined && typeof b.renew !== 'boolean') return bad(reply, 'renew');
    const renew = b.renew === true;
    if (b.challengeToken !== undefined) {
      const t = challengeToken.safeParse(b.challengeToken);
      if (!t.success) return bad(reply, 'challengeToken');
      if (await ipLimited(req)) return tooMany(reply);
      return run(req, reply, async () => respond(reply, await startEnrollment(deps(req), { via: 'challenge', challengeToken: t.data, renew, ipKey: ipKeyOf(req) }), (e) => e));
    }
    const userId = req.auth.userId;
    if (!userId) return sendError(reply, 'unauthenticated', NEED_LOGIN);
    const hasCode = b.currentCode !== undefined;
    const hasRec = b.recoveryCode !== undefined;
    if (hasCode && hasRec) return bad(reply, 'currentCode');
    let currentCode: string | undefined;
    let recoveryCode: string | undefined;
    if (hasCode) {
      const c = typeof b.currentCode === 'string' && b.currentCode.length <= 20 ? normalizeTotpInput(b.currentCode) : null;
      if (c === null) return bad(reply, 'currentCode');
      currentCode = c;
    }
    if (hasRec) {
      if (typeof b.recoveryCode !== 'string' || b.recoveryCode.length < 1 || b.recoveryCode.length > 40) return bad(reply, 'recoveryCode');
      recoveryCode = b.recoveryCode;
    }
    if (await ipLimited(req)) return tooMany(reply);
    return run(req, reply, async () =>
      respond(reply, await startEnrollment(deps(req), { via: 'session', userId, sessionToken: String(req.headers['x-bara-session']), renew, currentCode, recoveryCode, ipKey: ipKeyOf(req) }), (e) => e),
    );
  });

  // 4.4.3
  app.post('/v1/auth/mfa/enroll/current', async (req, reply) => {
    const b = bodyOf(req);
    if (b.challengeToken !== undefined) {
      const t = challengeToken.safeParse(b.challengeToken);
      if (!t.success) return bad(reply, 'challengeToken');
      return run(req, reply, async () => respond(reply, await currentEnrollment(deps(req), { via: 'challenge', challengeToken: t.data }), (e) => e));
    }
    const userId = req.auth.userId;
    if (!userId) return sendError(reply, 'unauthenticated', NEED_LOGIN);
    return run(req, reply, async () => respond(reply, await currentEnrollment(deps(req), { via: 'session', userId, sessionToken: String(req.headers['x-bara-session']) }), (e) => e));
  });

  // 4.4.4
  app.post('/v1/auth/mfa/enroll/confirm', async (req, reply) => {
    const b = bodyOf(req);
    const id = z.string().uuid().safeParse(b.enrollmentId);
    if (!id.success) return bad(reply, 'enrollmentId');
    const code = typeof b.code === 'string' && b.code.length <= 20 ? normalizeTotpInput(b.code) : null;
    if (code === null) return bad(reply, 'code');
    if (b.rotateRecoveryCodes !== undefined && typeof b.rotateRecoveryCodes !== 'boolean') return bad(reply, 'rotateRecoveryCodes');
    const rotate = b.rotateRecoveryCodes === true;
    const out = (r: { recoveryCodes: string[] | null; session: { sessionToken: string; expiresAt: Date; userId: string } | null }) => ({
      recoveryCodes: r.recoveryCodes,
      ...(r.session ? sessionBody(r.session) : {}),
    });
    if (b.challengeToken !== undefined) {
      const t = challengeToken.safeParse(b.challengeToken);
      if (!t.success) return bad(reply, 'challengeToken');
      if (await ipLimited(req)) return tooMany(reply);
      return run(req, reply, async () =>
        respond(reply, await confirmEnrollment(deps(req), { via: 'challenge', challengeToken: t.data, enrollmentId: id.data, code, rotateRecoveryCodes: rotate, ip: logIp(req) }), out),
      );
    }
    const userId = req.auth.userId;
    if (!userId) return sendError(reply, 'unauthenticated', NEED_LOGIN);
    if (await ipLimited(req)) return tooMany(reply);
    const sessionToken = String(req.headers['x-bara-session']);
    return run(req, reply, async () =>
      respond(reply, await confirmEnrollment(deps(req), { via: 'session', userId, sessionToken, enrollmentId: id.data, code, rotateRecoveryCodes: rotate, ip: logIp(req) }), out),
    );
  });

  // 4.5
  app.get('/v1/auth/mfa/status', async (req, reply) => {
    const userId = req.auth.userId;
    if (!userId) return sendError(reply, 'unauthenticated', NEED_LOGIN);
    const r = await mfaStatus(
      { pool: app.deps.pool, mode: app.deps.config.mfa.mode, graceUntil: app.deps.config.mfa.graceUntil },
      userId,
      { expiresAt: req.auth.sessionExpiresAt!, mfaMethod: req.auth.sessionMfaMethod },
    );
    return respond(reply, r, (s) => s);
  });

  app.post('/v1/auth/mfa/recovery-codes', async (req, reply) => {
    const userId = req.auth.userId;
    if (!userId) return sendError(reply, 'unauthenticated', NEED_LOGIN);
    const b = bodyOf(req);
    const code = typeof b.code === 'string' && b.code.length <= 20 ? normalizeTotpInput(b.code) : null;
    if (code === null) return bad(reply, 'code');
    if (await ipLimited(req)) return tooMany(reply);
    return run(req, reply, async () => respond(reply, await regenerateRecoveryCodes(deps(req), { userId, code, ip: logIp(req), ipKey: ipKeyOf(req) }), (r) => r));
  });

  app.post('/v1/auth/mfa/recovery-codes/ack', async (req, reply) => {
    const userId = req.auth.userId;
    if (!userId) return sendError(reply, 'unauthenticated', NEED_LOGIN);
    return respond(reply, await ackRecoveryCodes(app.deps.pool, userId), () => ({ ok: true }));
  });

  // 4.6
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply): Promise<string | null> => {
    const userId = req.auth.userId;
    if (!userId) {
      sendError(reply, 'unauthenticated', NEED_LOGIN);
      return null;
    }
    if (!(await isAdmin(userId))) {
      sendError(reply, 'forbidden', '관리자 권한이 필요합니다.');
      return null;
    }
    return userId;
  };

  const resetBody = z.object({
    code: z.string().max(20),
    reason: z.enum(ADMIN_RESET_REASONS),
    memo: z.string().max(1000).nullish(),
    identityChecked: z.literal(true),
  });

  app.post('/v1/admin/users/:id/mfa-reset', async (req, reply) => {
    const requesterId = await requireAdmin(req, reply);
    if (!requesterId) return reply;
    // off 모드에서도 2단계를 통과한 세션만 다른 관리자를 초기화할 수 있다(4.6.1)
    if (!req.auth.sessionMfaAt) return sendError(reply, 'forbidden', 'mfa_session_required');
    const p = idParam.safeParse(req.params);
    if (!p.success) return sendError(reply, 'not_found', 'not_found');
    const b = bodyOf(req);
    const parsed = resetBody.safeParse(b);
    const code = typeof b.code === 'string' && b.code.length <= 20 ? normalizeTotpInput(b.code) : null;
    if (code === null) return bad(reply, 'code');
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      return bad(reply, typeof field === 'string' ? field : 'code');
    }
    const memo = (parsed.data.memo ?? '').trim();
    const memoLen = [...memo].length;
    if ((parsed.data.reason === 'other' && memoLen < 5) || (memoLen > 0 && (memoLen < 5 || memoLen > 200))) return bad(reply, 'memo');
    if (await ipLimited(req)) return tooMany(reply);
    return run(req, reply, async () =>
      respond(
        reply,
        await adminResetMfa(deps(req), { requesterId, targetId: p.data.id, code, reason: parsed.data.reason, ip: logIp(req), ipKey: ipKeyOf(req) }),
        (r) => ({ ok: true, enrollTicket: r.enrollTicket, ticketExpiresAt: r.ticketExpiresAt }),
      ),
    );
  });

  app.get('/v1/admin/users/:id/mfa', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return reply;
    const p = idParam.safeParse(req.params);
    if (!p.success) return sendError(reply, 'not_found', 'not_found');
    return respond(reply, await adminGetMfa(app.deps.pool, p.data.id), (r) => r);
  });

  app.get('/v1/admin/mfa/overview', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return reply;
    return adminMfaOverview(app.deps.pool);
  });
}
