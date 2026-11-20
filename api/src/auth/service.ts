import type pg from 'pg';
import { withService } from '../db/context.js';
import type { Mailer } from '../mail/mailer.js';
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from './passwords.js';
import { release, reserve } from './rate-limit.js';
import { consumeEmailTokenIn, invalidateEmailTokensIn, issueEmailToken } from './tokens.js';
import { createSession, revokeAllSessionsIn, revokeOtherSessionsIn } from './sessions.js';

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
      await invalidateEmailTokensIn(tx, id, 'confirm');
    }
    return id;
  });
  if (!userId) return null;
  const s = await createSession(pool, userId, ttlDays);
  return { sessionToken: s.token, expiresAt: s.expiresAt };
}

const LOGIN_FAIL_LIMIT = 10;
const LOGIN_FAIL_WINDOW = 15 * 60;
const dummyHash = hashPassword('bara-dummy-password');

export type LoginResult =
  | { kind: 'ok'; sessionToken: string; expiresAt: Date; userId: string }
  | { kind: 'rate_limited' }
  | { kind: 'fail'; detail: 'invalid_credentials' | 'email_not_confirmed' | 'password_reset_required' };

export async function login(pool: pg.Pool, ttlDays: number, email: string, password: string): Promise<LoginResult> {
  const reservation = await reserve(pool, 'login-fail', email, LOGIN_FAIL_LIMIT, LOGIN_FAIL_WINDOW);
  if (reservation === null) return { kind: 'rate_limited' };
  const r = await withService(pool, (tx) =>
    tx.query<{ id: string; encrypted_password: string | null; email_confirmed_at: Date | null }>(
      'select id, encrypted_password, email_confirmed_at from auth.users where lower(email) = $1',
      [email],
    ),
  );
  const user = r.rows[0];
  const check = await verifyPassword(password, user?.encrypted_password ?? null);
  if (check === 'unsupported') await verifyPassword(password, await dummyHash);

  if (!user || check === 'mismatch') return { kind: 'fail', detail: 'invalid_credentials' };
  if (check === 'unsupported') return { kind: 'fail', detail: 'password_reset_required' };
  if (!user.email_confirmed_at) return { kind: 'fail', detail: 'email_not_confirmed' };
  await release(pool, reservation);
  const s = await createSession(pool, user.id, ttlDays);
  return { kind: 'ok', sessionToken: s.token, expiresAt: s.expiresAt, userId: user.id };
}

export async function changePassword(pool: pg.Pool, userId: string, currentToken: string, currentPassword: string, newPassword: string): Promise<boolean> {
  const r = await withService(pool, (tx) => tx.query<{ encrypted_password: string | null }>('select encrypted_password from auth.users where id = $1', [userId]));
  if (r.rowCount === 0) return false;
  if ((await verifyPassword(currentPassword, r.rows[0].encrypted_password)) !== 'ok') return false;
  const newHash = await hashPassword(newPassword);
  await withService(pool, async (tx) => {
    await tx.query('update auth.users set encrypted_password = $2, updated_at = now() where id = $1', [userId, newHash]);
    await revokeOtherSessionsIn(tx, userId, currentToken);
    await invalidateEmailTokensIn(tx, userId);
  });
  return true;
}

export async function requestReset(pool: pg.Pool, mailer: Mailer, email: string, origin: string, onMailError: MailErrorLogger): Promise<void> {
  const r = await withService(pool, (tx) => tx.query<{ id: string }>('select id from auth.users where lower(email) = $1', [email]));
  if (r.rowCount === 0) return;
  const token = await issueEmailToken(pool, r.rows[0].id, 'recovery');
  await mailer.send({ to: email, template: 'recovery', link: `${origin}/reset-password?token=${token}` }).catch(onMailError);
}

export async function resetPassword(pool: pg.Pool, token: string, newPassword: string): Promise<boolean> {
  const newHash = await hashPassword(newPassword);
  return withService(pool, async (tx) => {
    const id = await consumeEmailTokenIn(tx, token, 'recovery');
    if (!id) return false;
    await tx.query(
      'update auth.users set encrypted_password = $2, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = $1',
      [id, newHash],
    );
    await tx.query('delete from auth.sessions where user_id = $1', [id]);
    await invalidateEmailTokensIn(tx, id);
    return true;
  });
}

export async function confirmEmailAsAdmin(pool: pg.Pool, userId: string): Promise<boolean> {
  const r = await withService(pool, (tx) =>
    tx.query('update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = $1', [userId]),
  );
  return r.rowCount > 0;
}

export async function sendResetAsAdmin(pool: pg.Pool, mailer: Mailer, userId: string, origin: string, onMailError: MailErrorLogger): Promise<'not_found' | 'sent' | 'mail_failed'> {
  const r = await withService(pool, (tx) => tx.query<{ email: string }>('select email from auth.users where id = $1', [userId]));
  if (r.rowCount === 0) return 'not_found';
  const token = await issueEmailToken(pool, userId, 'recovery');
  let failed = false;
  await mailer.send({ to: r.rows[0].email, template: 'recovery', link: `${origin}/reset-password?token=${token}` }).catch((err) => {
    failed = true;
    onMailError(err);
  });
  return failed ? 'mail_failed' : 'sent';
}

export async function listConfirmations(pool: pg.Pool): Promise<Array<{ id: string; emailConfirmedAt: string | null }>> {
  const r = await withService(pool, (tx) =>
    tx.query<{ id: string; email_confirmed_at: Date | null }>('select id, email_confirmed_at from auth.users order by created_at, id'),
  );
  return r.rows.map((row) => ({ id: row.id, emailConfirmedAt: row.email_confirmed_at ? row.email_confirmed_at.toISOString() : null }));
}

export async function withdrawAnonymize(pool: pg.Pool, userId: string, anonymizedEmail: string): Promise<boolean> {
  const hash = await hashPassword(randomBytes(32).toString('base64url'));
  return withService(pool, async (tx) => {
    const r = await tx.query(
      "update auth.users set email = $2, encrypted_password = $3, raw_user_meta_data = '{}'::jsonb, updated_at = now() where id = $1",
      [userId, anonymizedEmail, hash],
    );
    if (r.rowCount === 0) return false;
    await revokeAllSessionsIn(tx, userId);
    await invalidateEmailTokensIn(tx, userId);
    return true;
  });
}
