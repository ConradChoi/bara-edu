import type { FastifyInstance } from 'fastify';
import { withAnon, withService, withUser, type Tx } from '../db/context.js';
import { sendError } from '../http/errors.js';
import type { Registry } from './registry.js';

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
    const exec = (tx: Tx) => op.run({ tx, userId }, parsed.data);
    let data: unknown;
    if (op.access === 'service') data = await withService(pool, exec);
    else if (userId) data = await withUser(pool, userId, exec);
    else data = await withAnon(pool, exec);
    return { data };
  });
}
