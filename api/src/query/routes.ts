import type { FastifyInstance } from 'fastify';
import { withAnon, withUser, type Tx } from '../db/context.js';
import { sendError } from '../http/errors.js';
import { buildCount, buildSelect, buildWrite, filtersWithinLimits, QueryError, requestSchema } from './build.js';
import type { Catalog } from './catalog.js';
import { toDbError } from './db-error.js';

const SINGLE_ERROR = { error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };

export function registerQueryRoutes(app: FastifyInstance, getCatalog: () => Promise<Catalog>): void {
  app.post('/v1/query', async (req, reply) => {
    if (!filtersWithinLimits(req.body)) return sendError(reply, 'validation', '요청 형식이 올바르지 않습니다.');
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 'validation', '요청 형식이 올바르지 않습니다.');
    const q = parsed.data;
    const wantRows = q.action === 'select' ? !q.head : q.returning === true;
    const cat = await getCatalog();
    let sel: ReturnType<typeof buildSelect>;
    let count: ReturnType<typeof buildCount> | null = null;
    try {
      if (q.action === 'select') {
        sel = buildSelect(cat, q);
        if (q.count === 'exact') count = buildCount(cat, q);
      } else sel = buildWrite(cat, q);
    } catch (err) {
      if (err instanceof QueryError) return sendError(reply, 'validation', '요청 형식이 올바르지 않습니다.');
      throw err;
    }

    const exec = async (tx: Tx) => {
      await tx.query("set local timezone = 'UTC'");
      let rows: unknown[] | null = null;
      if (wantRows) rows = (await tx.query<{ data: unknown[] }>(sel.text, sel.values)).rows[0].data;
      else if (q.action !== 'select') await tx.query(sel.text, sel.values);
      const n = count ? (await tx.query<{ count: number }>(count.text, count.values)).rows[0].count : null;
      return { rows, n };
    };
    const userId = req.auth.userId;
    let result: Awaited<ReturnType<typeof exec>>;
    try {
      result = userId ? await withUser(app.deps.pool, userId, exec) : await withAnon(app.deps.pool, exec);
    } catch (err) {
      const mapped = toDbError(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }

    const { rows, n } = result;
    if (q.single && rows) {
      if (rows.length > 1 || (rows.length === 0 && q.single === 'one')) return reply.code(406).send(SINGLE_ERROR);
      return { data: rows[0] ?? null, count: n };
    }
    return { data: rows, count: n };
  });
}
