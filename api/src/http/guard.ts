import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { inspectSession, type MfaMethod, type SessionEndReason } from '../auth/sessions.js';
import { sendError } from './errors.js';

export type RequestAuth = {
  userId: string | null;
  sessionExpiresAt: Date | null;
  sessionRenewed: boolean;
  // 이 요청에서 guard가 세션을 지운 이유(관리자 세션만). /v1/auth/session의 401 reason(max·idle)으로 한 번만 전달된다.
  endedReason: SessionEndReason | null;
  // 2단계를 통과해 만든 세션인가(mfa_at), 어떻게 통과했는가
  sessionMfaAt: Date | null;
  sessionMfaMethod: MfaMethod | null;
};

declare module 'fastify' {
  interface FastifyRequest {
    auth: RequestAuth;
  }
}

export function keyMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

// 관리자 1시간 미사용 판정의 "사용"(기획서 2.3, 보안 점검 M-1): 앱 proxy가 /admin 화면 요청에 붙인 x-bara-activity: admin(프리페치 제외),
// /v1/admin/*, 관리자 전용 ops, /v1/auth/mfa/*의 세션 요청. /v1/query 쓰기는 본문을 봐야 해서 query 라우트가 따로 갱신한다.
const ADMIN_OPS = new Set(['enrollments.approve']);
const PREFETCH_HEADERS = ['next-router-prefetch', 'purpose', 'sec-purpose'];

export function isAdminActivity(req: FastifyRequest): boolean {
  if (PREFETCH_HEADERS.some((h) => {
    const v = req.headers[h];
    return h === 'next-router-prefetch' ? v !== undefined : typeof v === 'string' && /prefetch/i.test(v);
  })) return false;
  if (req.headers['x-bara-activity'] === 'admin') return true;
  const path = req.url.split('?')[0];
  if (path.startsWith('/v1/admin/') || path.startsWith('/v1/auth/mfa/')) return true;
  if (path.startsWith('/v1/op/')) {
    const name = decodeURIComponent(path.slice('/v1/op/'.length));
    return name.startsWith('admin.') || ADMIN_OPS.has(name);
  }
  return false;
}

const EMPTY: RequestAuth = { userId: null, sessionExpiresAt: null, sessionRenewed: false, endedReason: null, sessionMfaAt: null, sessionMfaMethod: null };

export function registerGuard(app: FastifyInstance): void {
  app.decorateRequest('auth', null as unknown as RequestAuth);
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/healthz') return;
    const { config, pool } = app.deps;
    if (!keyMatches(req.headers['x-bara-service-key'], config.serviceKey)) {
      return sendError(reply, 'unauthorized_service', '서비스 키가 올바르지 않습니다.');
    }
    const token = req.headers['x-bara-session'];
    const s =
      typeof token === 'string' && token
        ? await inspectSession(pool, token, config.sessionTtlDays, { mode: config.mfa.mode, activity: isAdminActivity(req) })
        : null;
    if (s === null) req.auth = { ...EMPTY };
    else if (s.kind === 'ended') req.auth = { ...EMPTY, endedReason: s.reason };
    else req.auth = { userId: s.userId, sessionExpiresAt: s.expiresAt, sessionRenewed: s.renewed, endedReason: null, sessionMfaAt: s.mfaAt, sessionMfaMethod: s.mfaMethod };
  });
}
