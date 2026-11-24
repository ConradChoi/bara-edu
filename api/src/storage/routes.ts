import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { withUser } from '../db/context.js';
import { sendError } from '../http/errors.js';

const MAX_BYTES = 5 * 1024 * 1024;
const PATH_RE = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,100}$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const notDots = (s: string) => !/^\.+$/.test(s);

const uploadBody = z
  .object({
    fileName: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).refine(notDots),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    dataBase64: z.string().max(Math.ceil((MAX_BYTES * 4) / 3) + 8),
  })
  .strict();
const pathBody = z
  .object({ path: z.string().regex(PATH_RE).refine((p) => notDots(p.split('/')[1]!)) })
  .strict();

const bad = (reply: FastifyReply) => sendError(reply, 'validation', '요청 형식이 올바르지 않습니다.');

export function registerStorageRoutes(app: FastifyInstance): void {
  const authorize = async (req: FastifyRequest, reply: FastifyReply, path: string): Promise<boolean> => {
    const userId = req.auth.userId!;
    if (path.split('/')[0] === userId) return true;
    const r = await withUser(app.deps.pool, userId, (tx) => tx.query<{ ok: boolean }>('select public.is_admin() as ok'));
    if (r.rows[0]?.ok === true) return true;
    sendError(reply, 'forbidden', '접근 권한이 없습니다.');
    return false;
  };

  app.post('/v1/storage/member-photos', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const userId = req.auth.userId;
    if (!userId) return sendError(reply, 'unauthenticated', '로그인이 필요합니다.');
    const parsed = uploadBody.safeParse(req.body);
    if (!parsed.success) return bad(reply);
    const { fileName, contentType, dataBase64 } = parsed.data;
    if (dataBase64.length === 0 || !BASE64_RE.test(dataBase64)) return bad(reply);
    const body = Buffer.from(dataBase64, 'base64');
    if (body.length === 0 || body.length > MAX_BYTES || body.toString('base64') !== dataBase64) return bad(reply);
    const path = `${userId}/${fileName}`;
    await app.deps.storage.put(path, body, contentType);
    return { path };
  });

  app.post('/v1/storage/member-photos/remove', async (req, reply) => {
    if (!req.auth.userId) return sendError(reply, 'unauthenticated', '로그인이 필요합니다.');
    const parsed = pathBody.safeParse(req.body);
    if (!parsed.success) return bad(reply);
    if (!(await authorize(req, reply, parsed.data.path))) return reply;
    await app.deps.storage.remove(parsed.data.path);
    return { ok: true };
  });

  app.post('/v1/storage/member-photos/signed-url', async (req, reply) => {
    if (!req.auth.userId) return sendError(reply, 'unauthenticated', '로그인이 필요합니다.');
    const parsed = pathBody.safeParse(req.body);
    if (!parsed.success) return bad(reply);
    if (!(await authorize(req, reply, parsed.data.path))) return reply;
    return { url: await app.deps.storage.signedUrl(parsed.data.path, 60) };
  });
}
