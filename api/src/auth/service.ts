import type pg from 'pg';
import { withService } from '../db/context.js';
import type { Mailer } from '../mail/mailer.js';
import { hashPassword } from './passwords.js';
import { consumeEmailTokenIn, issueEmailToken } from './tokens.js';
import { createSession } from './sessions.js';

type SignupInput = { email: string; password: string; name: string; phone?: string | null; origin: string };

const confirmLink = (origin: string, token: string) => `${origin}/auth/confirm?token=${token}`;

export type MailErrorLogger = (err: unknown) => void;

export async function signup(pool: pg.Pool, mailer: Mailer, input: SignupInput, onMailError: MailErrorLogger): Promise<'pending_confirmation' | 'already_registered'> {
  const passwordHash = await hashPassword(input.password);
  const meta = { name: input.name, ...(input.phone ? { phone: input.phone } : {}) };
  const r = await withService(pool, (tx) =>
    tx.query<{ id: string }>(
      `insert into auth.users (email, encrypted_password, raw_user_meta_data)
       values ($1, $2, $3::jsonb) on conflict do nothing returning id`,
      [input.email, passwordHash, JSON.stringify(meta)],
    ),
  );
  if (r.rowCount === 0) return 'already_registered';
  const token = await issueEmailToken(pool, r.rows[0].id, 'confirm');
  await mailer.send({ to: input.email, template: 'confirm', link: confirmLink(input.origin, token) }).catch(onMailError);
  return 'pending_confirmation';
}

export async function resendConfirmation(pool: pg.Pool, mailer: Mailer, email: string, origin: string, onMailError: MailErrorLogger): Promise<void> {
  const r = await withService(pool, (tx) =>
    tx.query<{ id: string }>('select id from auth.users where lower(email) = $1 and email_confirmed_at is null', [email]),
  );
  if (r.rowCount === 0) return;
  const token = await issueEmailToken(pool, r.rows[0].id, 'confirm');
  await mailer.send({ to: email, template: 'confirm', link: confirmLink(origin, token) }).catch(onMailError);
}

export async function verifyEmail(pool: pg.Pool, ttlDays: number, token: string): Promise<{ sessionToken: string; expiresAt: Date } | null> {
  const userId = await withService(pool, async (tx) => {
    const id = await consumeEmailTokenIn(tx, token, 'confirm');
    if (id) {
      await tx.query('update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = $1', [id]);
    }
    return id;
  });
  if (!userId) return null;
  const s = await createSession(pool, userId, ttlDays);
  return { sessionToken: s.token, expiresAt: s.expiresAt };
}
