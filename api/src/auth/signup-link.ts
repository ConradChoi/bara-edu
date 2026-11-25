import { createHash } from 'node:crypto';
import type pg from 'pg';
import { withService, type Tx } from '../db/context.js';
import { verifyPassword } from './passwords.js';
import { invalidateEmailTokensIn, lockUserTokensIn } from './tokens.js';
import { createSessionIn } from './sessions.js';

// 가입 링크(가입 시도 하나에 묶인 confirm 토큰)의 상태 판정과 확정. 계약: docs/02-design/features/bara-edu-lms.signup-verify-password.api.md
export const MAX_ATTEMPTS_PER_USER = 5; // 한 계정의 유효 가입 시도 수
export const MAX_PASSWORD_TRIES = 5; // 한 시도의 비밀번호 비교 횟수(5회째 불일치에 잠금)

// 탈퇴 계정의 이메일은 익명화 주소다. 이 주소의 링크는 invalid로 보인다(done으로 보이면 사실과 다르다).
const WITHDRAWN = /@deleted\.invalid$/;

export type LinkState = 'ready' | 'done' | 'expired' | 'locked' | 'invalid';
export type LinkCheck =
  | { state: 'ready'; email: string; requestedAt: string; expiresAt: string; attemptsLeft: number }
  | { state: Exclude<LinkState, 'ready'> };

type LinkRow = {
  user_id: string;
  purpose: string;
  used_at: Date | null;
  token_expired: boolean;
  token_expires_at: Date;
  email: string;
  email_confirmed_at: Date | null;
  attempt_id: string | null;
  password_hash: string | null;
  name: string | null;
  phone: string | null;
  fail_count: number | null;
  locked_at: Date | null;
  attempt_expired: boolean | null;
  requested_at: Date | null;
};

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

async function readLink(tx: Tx, token: string): Promise<LinkRow | undefined> {
  const r = await tx.query<LinkRow>(
    `select t.user_id, t.purpose, t.used_at, t.expires_at as token_expires_at, (t.expires_at <= now()) as token_expired,
            u.email, u.email_confirmed_at,
            a.id as attempt_id, a.password_hash, a.name, a.phone, a.fail_count, a.locked_at,
            (a.expires_at <= now()) as attempt_expired, a.created_at as requested_at
       from auth.email_tokens t
       join auth.users u on u.id = t.user_id
       left join auth.signup_attempts a on a.id = t.attempt_id
      where t.token_hash = $1`,
    [sha256(token)],
  );
  return r.rows[0];
}

// 판정 순서는 계약 1.2절과 같다. 읽기 전용이라 check와 complete가 함께 쓴다.
function classify(row: LinkRow | undefined): LinkCheck {
  if (!row || row.purpose !== 'confirm') return { state: 'invalid' };
  if (WITHDRAWN.test(row.email)) return { state: 'invalid' };
  if (row.email_confirmed_at || row.used_at) return { state: 'done' };
  if (!row.attempt_id) return { state: 'invalid' }; // 시도가 정리됐거나 옛 방식 토큰
  const tries = row.fail_count ?? 0;
  if (row.locked_at || tries >= MAX_PASSWORD_TRIES) return { state: 'locked' };
  if (row.token_expired || row.attempt_expired) return { state: 'expired' };
  return {
    state: 'ready',
    email: row.email,
    requestedAt: row.requested_at!.toISOString(),
    expiresAt: row.token_expires_at.toISOString(),
    attemptsLeft: MAX_PASSWORD_TRIES - tries,
  };
}

// 부작용 없음: 토큰 사용·실패 횟수·세션·메일 어느 것도 바꾸지 않는다(메일 스캐너가 불러도 안전)
export function checkSignupLink(pool: pg.Pool, token: string): Promise<LinkCheck> {
  return withService(pool, async (tx) => classify(await readLink(tx, token)));
}

export type CompleteResult =
  | { kind: 'ok'; sessionToken: string; expiresAt: Date }
  | { kind: 'wrong_password'; attemptsLeft: number }
  | { kind: 'invalid' | 'locked' | 'expired' | 'done' };

type Reserved = { kind: 'reserved'; attemptId: string; userId: string; hash: string; tries: number };

export async function completeSignup(pool: pg.Pool, ttlDays: number, token: string, password: string): Promise<CompleteResult> {
  // 1) 비교 횟수를 먼저 예약한다. 시도 행 잠금 아래에서 올리므로 동시 요청이 와도 비교는 시도당 5회를 넘지 않는다.
  //    락 순서(토큰 -> 시도 -> 사용자 -> profiles)에 맞게 여기서는 시도 행만 잠근다.
  const reserved = await withService(pool, async (tx): Promise<Reserved | { kind: Exclude<LinkState, 'ready'> }> => {
    const peek = await readLink(tx, token);
    if (classify(peek).state !== 'ready') return { kind: classify(peek).state as Exclude<LinkState, 'ready'> };
    await tx.query('select 1 from auth.signup_attempts where id = $1 for update', [peek!.attempt_id]);
    const row = await readLink(tx, token); // 잠금을 기다리는 사이 바뀌었을 수 있어 다시 판정
    const c = classify(row);
    if (c.state !== 'ready') return { kind: c.state };
    const u = await tx.query<{ fail_count: number }>('update auth.signup_attempts set fail_count = fail_count + 1 where id = $1 returning fail_count', [row!.attempt_id]);
    return { kind: 'reserved', attemptId: row!.attempt_id!, userId: row!.user_id, hash: row!.password_hash!, tries: u.rows[0].fail_count };
  });
  if (reserved.kind !== 'reserved') return { kind: reserved.kind };

  // 2) bcrypt 비교는 트랜잭션 밖(행 잠금 시간을 줄인다)
  const match = (await verifyPassword(password, reserved.hash)) === 'ok';

  if (!match) {
    // 5회째 불일치 -> 그 시도를 영구 잠금. 5번째 시도에 맞는 비밀번호를 넣으면 아래 확정으로 간다.
    return withService(pool, async (tx): Promise<CompleteResult> => {
      if (reserved.tries >= MAX_PASSWORD_TRIES) {
        await tx.query('update auth.signup_attempts set locked_at = coalesce(locked_at, now()) where id = $1', [reserved.attemptId]);
        return { kind: 'locked' };
      }
      return { kind: 'wrong_password', attemptsLeft: MAX_PASSWORD_TRIES - reserved.tries };
    });
  }

  // 3) 확정: 토큰 -> 시도 -> 사용자 -> profiles 순으로 잠그고, 그 사이 다른 요청이 확정·정리했는지 다시 확인한다.
  return withService(pool, async (tx): Promise<CompleteResult> => {
    await lockUserTokensIn(tx, reserved.userId);
    const attempts = await tx.query<{ id: string; password_hash: string; name: string; phone: string | null }>(
      'select id, password_hash, name, phone from auth.signup_attempts where user_id = $1 order by id for update',
      [reserved.userId],
    );
    const mine = attempts.rows.find((a) => a.id === reserved.attemptId);
    if (!mine) {
      const s = classify(await readLink(tx, token)).state;
      return { kind: s === 'ready' || s === 'locked' ? 'done' : s };
    }
    const user = await tx.query<{ email_confirmed_at: Date | null }>('select email_confirmed_at from auth.users where id = $1 for update', [reserved.userId]);
    if (user.rowCount === 0) return { kind: 'invalid' };
    if (user.rows[0].email_confirmed_at) return { kind: 'done' };

    const meta = { name: mine.name, ...(mine.phone ? { phone: mine.phone } : {}) };
    await tx.query(
      `update auth.users set encrypted_password = $2, raw_user_meta_data = $3::jsonb,
              email_confirmed_at = now(), updated_at = now() where id = $1`,
      [reserved.userId, mine.password_hash, JSON.stringify(meta)],
    );
    await tx.query('update public.profiles set name = $2, phone = $3 where id = $1', [reserved.userId, mine.name, mine.phone]);
    // 같은 계정의 다른 시도(비밀번호 해시 포함)와 링크는 모두 무효: 시도는 지우고, 토큰은 사용 처리한다(옛 링크는 done으로 보인다)
    await invalidateEmailTokensIn(tx, reserved.userId, 'confirm');
    await tx.query('delete from auth.signup_attempts where user_id = $1', [reserved.userId]);
    const s = await createSessionIn(tx, reserved.userId, ttlDays);
    return { kind: 'ok', sessionToken: s.token, expiresAt: s.expiresAt };
  });
}
