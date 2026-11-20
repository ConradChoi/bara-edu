import type { FastifyInstance } from 'fastify';
import { withService } from '../db/context.js';
import { sendError } from '../http/errors.js';

type SessionRow = {
  id: string;
  email: string;
  email_confirmed_at: Date | null;
  role: string | null;
  status: string | null;
};

export function registerAuthRoutes(app: FastifyInstance): void {
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
