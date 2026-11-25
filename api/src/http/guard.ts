import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { resolveSession } from '../auth/sessions.js';
import { sendError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: { userId: string | null; sessionExpiresAt: Date | null };
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

export function registerGuard(app: FastifyInstance): void {
  app.decorateRequest('auth', null as unknown as { userId: string | null; sessionExpiresAt: Date | null });
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/healthz') return;
    const { config, pool } = app.deps;
    if (!keyMatches(req.headers['x-bara-service-key'], config.serviceKey)) {
      return sendError(reply, 'unauthorized_service', '서비스 키가 올바르지 않습니다.');
    }
    const token = req.headers['x-bara-session'];
    const session = typeof token === 'string' && token ? await resolveSession(pool, token, config.sessionTtlDays) : null;
    req.auth = { userId: session?.userId ?? null, sessionExpiresAt: session?.expiresAt ?? null };
  });
}
