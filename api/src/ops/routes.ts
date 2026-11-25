import type { FastifyInstance } from 'fastify';
import { withAnon, withService, withUser, type Tx } from '../db/context.js';
import { sendError } from '../http/errors.js';
import type { MailMessage } from '../mail/mailer.js';
import { OpError, type Registry } from './registry.js';

export function registerOpRoutes(app: FastifyInstance, registry: Registry): void {
  app.post<{ Params: { name: string } }>('/v1/op/:name', async (req, reply) => {
    const op = registry.get(req.params.name);
    if (!op) return sendError(reply, 'not_found', '존재하지 않는 오퍼레이션입니다.');
    const userId = req.auth.userId;
    if (op.access !== 'anon' && !userId) return sendError(reply, 'unauthenticated', '로그인이 필요합니다.');
    const body = req.body as { params?: unknown } | null | undefined;
    if (body === null || typeof body !== 'object') return sendError(reply, 'validation', '요청 형식이 올바르지 않습니다.');
    const parsed = op.params.safeParse(body.params ?? {});
    if (!parsed.success) return sendError(reply, 'validation', '요청 형식이 올바르지 않습니다.');
    const { pool } = app.deps;
    const ipHeader = req.headers['x-bara-client-ip'];
    const ip = (typeof ipHeader === 'string' ? ipHeader.trim().slice(0, 64) : '') || null;
    const mails: MailMessage[] = [];
    const exec = (tx: Tx) =>
      op.run({ tx, userId, ip, siteOrigin: app.deps.config.siteOrigins[0], queueMail: (m) => void mails.push(m) }, parsed.data);
    let data: unknown;
    try {
      if (op.access === 'service') data = await withService(pool, exec);
      else if (userId) data = await withUser(pool, userId, exec);
      else data = await withAnon(pool, exec);
    } catch (err) {
      if (err instanceof OpError) return sendError(reply, err.code, err.message);
      throw err;
    }
    // 커밋된 뒤에만 보낸다. 응답을 기다리지 않고, 실패는 기록만 한다(주소·내용은 남기지 않는다).
    for (const m of mails) {
      setImmediate(() => {
        app.deps.mailer.send(m).catch((e: unknown) => req.log.error({ errorName: e instanceof Error ? e.name : 'unknown' }, 'op mail failed'));
      });
    }
    return { data };
  });
}
