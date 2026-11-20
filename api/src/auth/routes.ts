import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withService } from '../db/context.js';
import { z } from 'zod';
import { sendError } from '../http/errors.js';
import { hit, normalizeEmail } from './rate-limit.js';
import { resendConfirmation, signup, verifyEmail } from './service.js';

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

const INVALID = '요청 형식이 올바르지 않습니다.';

function clientIp(req: FastifyRequest): string {
  const h = req.headers['x-bara-client-ip'];
  const v = typeof h === 'string' ? h.trim().slice(0, 64) : '';
  return v || req.ip;
}

export function registerAuthRoutes(app: FastifyInstance): void {
  const originAllowed = (origin: string) => app.deps.config.siteOrigins.includes(origin);

  app.post('/v1/auth/signup', async (req, reply) => {
    const body = signupBody.safeParse(req.body);
    if (!body.success || !originAllowed(body.data.origin)) return sendError(reply, 'validation', INVALID);
    if (!(await hit(app.deps.pool, 'signup', clientIp(req), 10, 3600))) {
      return sendError(reply, 'rate_limited', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    }
    return { status: await signup(app.deps.pool, app.deps.mailer, body.data) };
  });

  app.post('/v1/auth/resend', async (req, reply) => {
    const body = resendBody.safeParse(req.body);
    if (!body.success || !originAllowed(body.data.origin)) return sendError(reply, 'validation', INVALID);
    const { pool, mailer } = app.deps;
    const { email: to, origin } = body.data;
    const allowed = (await hit(pool, 'resend-60s', to, 1, 60)) && (await hit(pool, 'resend-1h', to, 4, 3600));
    if (allowed) await resendConfirmation(pool, mailer, to, origin);
    return { status: 'pending_confirmation' };
  });

  app.post('/v1/auth/verify-email', async (req, reply) => {
    const body = verifyBody.safeParse(req.body);
    if (!body.success) return sendError(reply, 'validation', INVALID);
    const { pool, config } = app.deps;
    const r = await verifyEmail(pool, config.sessionTtlDays, body.data.token);
    if (!r) return sendError(reply, 'validation', 'invalid_token');
    return { sessionToken: r.sessionToken, expiresAt: r.expiresAt };
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
