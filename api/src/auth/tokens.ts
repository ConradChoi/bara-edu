import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { withService, type Tx } from '../db/context.js';

export type TokenPurpose = 'confirm' | 'recovery';

const TTL_SECONDS: Record<TokenPurpose, number> = { confirm: 24 * 3600, recovery: 3600 };

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

// attemptId: 새 방식의 confirm 토큰은 가입 시도 하나에 묶인다(링크 = 그 시도의 비밀번호로만 열림)
export async function issueEmailTokenIn(tx: Tx, userId: string, purpose: TokenPurpose, attemptId: string | null = null): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await tx.query(
    `insert into auth.email_tokens (token_hash, user_id, purpose, expires_at, attempt_id)
     values ($1, $2, $3, now() + make_interval(secs => $4::int), $5)`,
    [sha256(token), userId, purpose, TTL_SECONDS[purpose], attemptId],
  );
  return token;
}

export function issueEmailToken(pool: pg.Pool, userId: string, purpose: TokenPurpose, attemptId: string | null = null): Promise<string> {
  return withService(pool, (tx) => issueEmailTokenIn(tx, userId, purpose, attemptId));
}

// 잠그지 않고 토큰의 주인만 읽는다. 호출한 쪽이 그 회원의 토큰을 정해진 순서로 먼저 잠근 뒤 consumeEmailTokenIn을 부르기 위해 쓴다
// (토큰 하나만 먼저 갱신하고 나머지를 나중에 갱신하면, 같은 회원의 다른 토큰을 쥔 요청과 서로 기다리다 데드락이 난다).
export async function peekEmailTokenUserIn(tx: Tx, token: string, purpose: TokenPurpose): Promise<string | null> {
  const r = await tx.query<{ user_id: string }>(
    'select user_id from auth.email_tokens where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()',
    [sha256(token), purpose],
  );
  return r.rowCount === 0 ? null : r.rows[0].user_id;
}

export async function consumeEmailTokenIn(tx: Tx, token: string, purpose: TokenPurpose): Promise<string | null> {
  const r = await tx.query<{ user_id: string }>(
    `update auth.email_tokens set used_at = now()
      where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
      returning user_id`,
    [sha256(token), purpose],
  );
  return r.rowCount === 0 ? null : r.rows[0].user_id;
}

// 락 순서 규칙: 이메일 토큰 -> 가입 시도(auth.signup_attempts) -> 사용자(auth.users) -> profiles.
// verify-email·reset-password는 토큰을 먼저 갱신한 뒤 사용자를 갱신한다. 사용자 행을 먼저 잠그는 경로(재가입 덮어쓰기, 탈퇴,
// 비밀번호 변경)는 시작할 때 이 함수로 그 회원의 토큰 행부터 잠가 같은 순서를 지킨다(AB-BA 데드락 방지).
export async function lockUserTokensIn(tx: Tx, userId: string): Promise<void> {
  await tx.query('select 1 from auth.email_tokens where user_id = $1 order by token_hash for update', [userId]);
}

// 같은 회원의 토큰을 잠근 뒤 가입 시도까지 잠근다(위 순서). 사용자 행을 먼저 잠그고 시도를 건드리는 경로(재가입, 탈퇴)는 이 함수로 시작한다.
export async function lockUserSignupIn(tx: Tx, userId: string): Promise<void> {
  await lockUserTokensIn(tx, userId);
  await tx.query('select 1 from auth.signup_attempts where user_id = $1 order by id for update', [userId]);
}

export async function invalidateEmailTokensIn(tx: Tx, userId: string, purpose?: TokenPurpose): Promise<void> {
  await tx.query(
    'update auth.email_tokens set used_at = now() where user_id = $1 and used_at is null and ($2::text is null or purpose = $2)',
    [userId, purpose ?? null],
  );
}

export function consumeEmailToken(pool: pg.Pool, token: string, purpose: TokenPurpose): Promise<string | null> {
  return withService(pool, (tx) => consumeEmailTokenIn(tx, token, purpose));
}
