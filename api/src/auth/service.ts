import type pg from 'pg';
import { withService } from '../db/context.js';
import type { MailMessage } from '../mail/mailer.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { hit, release, reserve } from './rate-limit.js';
import { consumeEmailTokenIn, invalidateEmailTokensIn, issueEmailToken } from './tokens.js';
import { createSession, revokeOtherSessionsIn } from './sessions.js';

type SignupInput = { email: string; password: string; name: string; phone?: string | null; origin: string };

const confirmLink = (origin: string, token: string) => `${origin}/auth/confirm?token=${token}`;

// queues the message for sending after the HTTP response; must not throw or await the send
export type MailDeliver = (msg: MailMessage) => void;

// 어떤 경우에도 같은 값을 돌려준다(이메일 열거 방지, 대표 결정 2026-11-25). 신규/인증 완료/미인증은 보내는 메일만 다르다.
// 탈퇴 계정의 이메일은 `withdrawn+<id>@deleted.invalid`로 바뀌어 원래 주소는 비어 있으므로 새 가입으로 처리되고,
// 익명화 주소로 가입을 시도하면 기존 계정으로 취급하되 보낼 곳이 없어 메일은 보내지 않는다.
const UNDELIVERABLE = /@deleted\.invalid$/;

export async function signup(pool: pg.Pool, deliver: MailDeliver, input: SignupInput): Promise<'pending_confirmation'> {
  const passwordHash = await hashPassword(input.password);
  const meta = { name: input.name, ...(input.phone ? { phone: input.phone } : {}) };
  const r = await withService(pool, (tx) =>
    tx.query<{ id: string }>(
      `insert into auth.users (email, encrypted_password, raw_user_meta_data)
       values ($1, $2, $3::jsonb) on conflict do nothing returning id`,
      [input.email, passwordHash, JSON.stringify(meta)],
    ),
  );
  if (r.rowCount > 0) {
    const token = await issueEmailToken(pool, r.rows[0].id, 'confirm');
    deliver({ to: input.email, template: 'confirm', link: confirmLink(input.origin, token) });
    return 'pending_confirmation';
  }

  const existing = await withService(pool, (tx) =>
    tx.query<{ id: string; email_confirmed_at: Date | null }>('select id, email_confirmed_at from auth.users where lower(email) = $1', [input.email]),
  );
  const user = existing.rows[0];
  if (!user || UNDELIVERABLE.test(input.email)) return 'pending_confirmation';
  if (user.email_confirmed_at) {
    // 같은 주소로 가입을 반복해 안내 메일을 쏟아내지 못하게 resend와 같은 간격으로 제한한다
    if ((await hit(pool, 'already-60s', input.email, 1, 60)) && (await hit(pool, 'already-1h', input.email, 4, 3600))) {
      deliver({ to: input.email, template: 'already_registered', link: `${input.origin}/sign-in` });
    }
    return 'pending_confirmation';
  }
  // 미인증 기존 계정: 인증 메일을 다시 보낸다(/v1/auth/resend와 같은 60초·1시간 제한)
  if ((await hit(pool, 'resend-60s', input.email, 1, 60)) && (await hit(pool, 'resend-1h', input.email, 4, 3600))) {
    await resendConfirmation(pool, deliver, input.email, input.origin);
  }
  return 'pending_confirmation';
}

export async function resendConfirmation(pool: pg.Pool, deliver: MailDeliver, email: string, origin: string): Promise<void> {
  const r = await withService(pool, (tx) =>
    tx.query<{ id: string }>('select id from auth.users where lower(email) = $1 and email_confirmed_at is null', [email]),
  );
  if (r.rowCount === 0) {
    await hit(pool, 'resend-miss', email, 1, 60);
    return;
  }
  const token = await issueEmailToken(pool, r.rows[0].id, 'confirm');
  deliver({ to: email, template: 'confirm', link: confirmLink(origin, token) });
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

export async function requestReset(pool: pg.Pool, deliver: MailDeliver, email: string, origin: string): Promise<void> {
  const r = await withService(pool, (tx) => tx.query<{ id: string }>('select id from auth.users where lower(email) = $1', [email]));
  if (r.rowCount === 0) {
    await hit(pool, 'reset-miss', email, 1, 60);
    return;
  }
  const token = await issueEmailToken(pool, r.rows[0].id, 'recovery');
  deliver({ to: email, template: 'recovery', link: `${origin}/reset-password?token=${token}` });
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

export async function sendResetAsAdmin(pool: pg.Pool, deliver: MailDeliver, userId: string, origin: string): Promise<'not_found' | 'queued'> {
  const r = await withService(pool, (tx) => tx.query<{ email: string }>('select email from auth.users where id = $1', [userId]));
  if (r.rowCount === 0) return 'not_found';
  const token = await issueEmailToken(pool, userId, 'recovery');
  deliver({ to: r.rows[0].email, template: 'recovery', link: `${origin}/reset-password?token=${token}` });
  return 'queued';
}

export async function listConfirmations(pool: pg.Pool): Promise<Array<{ id: string; emailConfirmedAt: string | null }>> {
  const r = await withService(pool, (tx) =>
    tx.query<{ id: string; email_confirmed_at: Date | null }>('select id, email_confirmed_at from auth.users order by created_at, id'),
  );
  return r.rows.map((row) => ({ id: row.id, emailConfirmedAt: row.email_confirmed_at ? row.email_confirmed_at.toISOString() : null }));
}
