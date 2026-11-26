import type pg from 'pg';
import { withService, type Tx } from '../db/context.js';
import type { MailMessage } from '../mail/mailer.js';
import { kstStamp } from '../mail/kst.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { hit, release, reserve } from './rate-limit.js';
import { consumeEmailTokenIn, invalidateEmailTokensIn, issueEmailToken, issueEmailTokenIn, lockUserSignupIn, lockUserTokensIn, peekEmailTokenUserIn } from './tokens.js';
import { createSession, revokeOtherSessionsIn } from './sessions.js';
import { MAX_ATTEMPTS_PER_USER, MAX_PASSWORD_TRIES } from './signup-link.js';

type SignupInput = { email: string; password: string; name: string; phone?: string | null; origin: string };

const confirmLink = (origin: string, token: string) => `${origin}/auth/confirm?token=${token}`;

// queues the message for sending after the HTTP response; must not throw or await the send
export type MailDeliver = (msg: MailMessage) => void;

// 어떤 경우에도 같은 값을 돌려준다(이메일 열거 방지, 대표 결정 2026-11-25). 신규/인증 완료/미인증은 보내는 메일만 다르다.
// 탈퇴 계정의 이메일은 `withdrawn+<id>@deleted.invalid`로 바뀌어 원래 주소는 비어 있으므로 새 가입으로 처리되고,
// 익명화 주소로 가입을 시도하면 기존 계정으로 취급하되 보낼 곳이 없어 메일은 보내지 않는다.
const UNDELIVERABLE = /@deleted\.invalid$/;

// 가입 시도 하나를 저장하고 그 시도에 묶인 인증 링크(토큰)를 발급한다. 호출한 트랜잭션 안에서 쓴다.
async function addAttemptIn(tx: Tx, userId: string, passwordHash: string, input: SignupInput): Promise<string> {
  const a = await tx.query<{ id: string }>(
    'insert into auth.signup_attempts (user_id, password_hash, name, phone) values ($1, $2, $3, $4) returning id',
    [userId, passwordHash, input.name, input.phone ? input.phone : null],
  );
  return issueEmailTokenIn(tx, userId, 'confirm', a.rows[0].id);
}

export async function signup(pool: pg.Pool, deliver: MailDeliver, input: SignupInput): Promise<'pending_confirmation'> {
  const passwordHash = await hashPassword(input.password);
  const meta = { name: input.name, ...(input.phone ? { phone: input.phone } : {}) };
  // 신규: 계정 행은 비밀번호 없이 만든다(미인증 계정의 encrypted_password는 NULL). 비밀번호 해시는 가입 시도에만 있다.
  // 프로필(이름·연락처)은 트리거가 이 값으로 만들고, 확정 때 확정한 시도의 값으로 다시 맞춘다.
  const fresh = await withService(pool, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data)
       values ($1, $2::jsonb) on conflict do nothing returning id`,
      [input.email, JSON.stringify(meta)],
    );
    if (r.rowCount === 0) return null;
    return addAttemptIn(tx, r.rows[0].id, passwordHash, input);
  });
  if (fresh) {
    deliver({ to: input.email, template: 'confirm', link: confirmLink(input.origin, fresh) });
    return 'pending_confirmation';
  }

  const existing = await withService(pool, (tx) =>
    tx.query<{ id: string; email_confirmed_at: Date | null }>('select id, email_confirmed_at from auth.users where lower(email) = $1', [input.email]),
  );
  const user = existing.rows[0];
  if (!user || UNDELIVERABLE.test(input.email)) return 'pending_confirmation';
  if (user.email_confirmed_at) {
    // 같은 주소로 가입을 반복해 안내 메일을 쏟아내지 못하게 resend와 같은 간격으로 제한한다
    // 하루 1통(가장 엄격한 것부터 확인): 특정 주소로 안내 메일을 쏟아내 SES 발신 평판을 해치는 것을 막는다
    if ((await hit(pool, 'already-24h', input.email, 1, 86_400)) && (await hit(pool, 'already-60s', input.email, 1, 60)) && (await hit(pool, 'already-1h', input.email, 4, 3600))) {
      // origin은 허용 목록(siteOrigins)을 통과한 요청 값이다(가입 인증·재설정 링크와 같은 출처)
      deliver({ to: input.email, template: 'already_registered', link: `${input.origin}/sign-in`, forgotLink: `${input.origin}/forgot-password` });
    }
    return 'pending_confirmation';
  }
  // 미인증 기존 계정: 계정 행·프로필은 덮어쓰지 않고 가입 시도만 하나 더 추가한 뒤 그 시도의 인증 메일을 보낸다(/v1/auth/resend와 같은 60초·1시간 제한).
  // 링크는 각자 자기 시도의 비밀번호로만 열리므로, 남의 이메일로 미리 가입해 둔 사람(선점자)은 링크를 받지 못해 아무것도 확정할 수 없다.
  // 제한에 걸리면 아무것도 바꾸지 않는다(메일과 시도 저장은 한 묶음).
  if (!((await hit(pool, 'resend-60s', input.email, 1, 60)) && (await hit(pool, 'resend-1h', input.email, 4, 3600)))) return 'pending_confirmation';
  const token = await withService(pool, async (tx) => {
    await lockUserSignupIn(tx, user.id); // 락 순서: 토큰 -> 시도 -> 사용자
    // 확정 처리와 겹치지 않게 행을 잠그고, 그 사이 인증됐다면 시도를 만들지 않는다
    const u = await tx.query('select 1 from auth.users where id = $1 and email_confirmed_at is null for update', [user.id]);
    if (u.rowCount === 0) return null;
    const t = await addAttemptIn(tx, user.id, passwordHash, input);
    // 유효 시도는 계정당 최대 5개: 6번째가 생기면 가장 오래된 시도와 그 링크를 무효로 만든다
    await tx.query(
      `delete from auth.signup_attempts where user_id = $1 and id not in (
         select id from auth.signup_attempts where user_id = $1 order by created_at desc, id desc limit $2)`,
      [user.id, MAX_ATTEMPTS_PER_USER],
    );
    return t;
  });
  if (token) deliver({ to: input.email, template: 'confirm', link: confirmLink(input.origin, token) });
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
  // 가장 최근의 "잠기지 않은 유효 시도"에 새 링크를 붙인다. 같은 시도라 실패 횟수가 이어진다(재전송으로 잠금을 우회하지 못함).
  // 해당 시도가 없으면(모두 잠김·7일 경과·옛 방식 계정) 메일을 보내지 않는다 — 응답은 호출한 쪽에서 항상 같다.
  const token = await withService(pool, async (tx) => {
    await lockUserSignupIn(tx, r.rows[0].id); // 락 순서: 토큰 -> 시도 -> 사용자. 확정·정리와 겹쳐 사라진 시도에 토큰을 달지 않게 잠근 뒤 고른다
    const still = await tx.query('select 1 from auth.users where id = $1 and email_confirmed_at is null for update', [r.rows[0].id]);
    if (still.rowCount === 0) return null;
    const a = await tx.query<{ id: string }>(
      `select id from auth.signup_attempts
        where user_id = $1 and locked_at is null and fail_count < $2 and expires_at > now()
        order by created_at desc, id desc limit 1`,
      [r.rows[0].id, MAX_PASSWORD_TRIES],
    );
    return a.rowCount === 0 ? null : issueEmailTokenIn(tx, r.rows[0].id, 'confirm', a.rows[0].id);
  });
  if (token) deliver({ to: email, template: 'confirm', link: confirmLink(origin, token) });
}

export const ADMIN_RESET_ACTION = '비밀번호재설정';
export const ADMIN_RESET_DETAIL = '재설정 메일 링크';
const LOGIN_FAIL_BUCKET = 'login-fail';
const LOGIN_FAIL_LIMIT = 10;
const LOGIN_FAIL_WINDOW = 15 * 60;
const dummyHash = hashPassword('bara-dummy-password');

export type LoginResult =
  | { kind: 'ok'; sessionToken: string; expiresAt: Date; userId: string }
  | { kind: 'rate_limited' }
  | { kind: 'fail'; detail: 'invalid_credentials' | 'email_not_confirmed' | 'password_reset_required' };

export async function login(pool: pg.Pool, ttlDays: number, email: string, password: string): Promise<LoginResult> {
  const reservation = await reserve(pool, LOGIN_FAIL_BUCKET, email, LOGIN_FAIL_LIMIT, LOGIN_FAIL_WINDOW);
  if (reservation === null) return { kind: 'rate_limited' };
  const r = await withService(pool, (tx) =>
    tx.query<{ id: string; encrypted_password: string | null; email_confirmed_at: Date | null }>(
      'select id, encrypted_password, email_confirmed_at from auth.users where lower(email) = $1',
      [email],
    ),
  );
  const user = r.rows[0];
  let check: 'ok' | 'mismatch' | 'unsupported';
  if (user && !user.email_confirmed_at && !user.encrypted_password) {
    // 미인증 계정은 비밀번호 칸이 비어 있다. 유효한 가입 시도들의 비밀번호와 비교해 하나라도 맞으면 "인증 필요", 아니면 "자격 증명 오류"(이전과 같은 결과).
    // 끝까지 모두 비교하고(맞는 것에서 멈추지 않음), 시도가 없으면 더미 비교를 한다.
    const attempts = await withService(pool, (tx) =>
      tx.query<{ password_hash: string }>('select password_hash from auth.signup_attempts where user_id = $1 and expires_at > now() order by created_at', [user.id]),
    );
    let matched = false;
    for (const a of attempts.rows) if ((await verifyPassword(password, a.password_hash)) === 'ok') matched = true;
    if (attempts.rowCount === 0) await verifyPassword(password, await dummyHash);
    check = matched ? 'ok' : 'mismatch';
  } else {
    check = await verifyPassword(password, user?.encrypted_password ?? null);
  }
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
    await lockUserTokensIn(tx, userId); // 락 순서: 토큰 -> 사용자
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

// 성공하면 비밀번호 변경 알림(password_changed) 메일을 큐에 넣는다. 발송 실패는 결과에 영향이 없다(deliver는 기다리지 않는다).
export async function resetPassword(pool: pg.Pool, deliver: MailDeliver, token: string, newPassword: string, ip: string | null = null): Promise<boolean> {
  // 쓸 수 없는 토큰이면 해시 계산(bcrypt) 전에 끝낸다(개인정보·보안 점검 I-2). 최종 판단은 아래 트랜잭션의 소모 결과다.
  if (!(await withService(pool, (tx) => peekEmailTokenUserIn(tx, token, 'recovery')))) return false;
  const newHash = await hashPassword(newPassword);
  const email = await withService(pool, async (tx) => {
    // 락 순서: 그 회원의 토큰 전부(token_hash 순) -> 시도 -> 사용자. 토큰 하나만 먼저 갱신하면 가입 확정과 서로 기다리다 데드락이 난다.
    // 재설정 링크는 그 메일함의 주인만 열 수 있으므로 인증도 함께 끝낸다(미인증 회원 복구 경로).
    const owner = await peekEmailTokenUserIn(tx, token, 'recovery');
    if (!owner) return null;
    await lockUserSignupIn(tx, owner);
    const id = await consumeEmailTokenIn(tx, token, 'recovery'); // 잠금을 기다리는 사이 쓰였을 수 있어 다시 소모한다
    if (!id) return null;
    const u = await tx.query<{ email: string }>(
      'update auth.users set encrypted_password = $2, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = $1 returning email',
      [id, newHash],
    );
    await tx.query('delete from auth.sessions where user_id = $1', [id]);
    await invalidateEmailTokensIn(tx, id);
    // 가입 시도(다른 사람이 넣은 비밀번호 해시 포함)는 모두 무효. 가입 링크는 위에서 사용 처리됐다.
    await tx.query('delete from auth.signup_attempts where user_id = $1', [id]);
    // 메일함 주인임이 확인됐으므로 그 이메일의 로그인 실패 제한을 푼다(대표 결정 2026-11-26 5번). 키는 login과 같은 정규화 이메일(소문자).
    // 같은 트랜잭션이라 재설정이 롤백되면 제한 기록도 남는다. 로그인 IP 제한(login-ip)은 그대로 둔다.
    await tx.query('delete from auth.rate_events where bucket = $1 and key = lower($2)', [LOGIN_FAIL_BUCKET, u.rows[0].email]);
    // 관리자 계정은 메일함만으로 복구되므로 기록을 남긴다(개인정보·보안 점검 I-3). 같은 트랜잭션이라 기록이 실패하면 재설정도 롤백된다.
    await tx.query(
      `insert into admin_access_logs (admin_id, target_user_id, action, detail, ip_address)
       select id, id, $2, $3, $4 from profiles where id = $1 and role = 'admin'`,
      [id, ADMIN_RESET_ACTION, ADMIN_RESET_DETAIL, ip],
    );
    return u.rows[0].email;
  });
  if (email === null) return false;
  if (!UNDELIVERABLE.test(email)) deliver({ to: email, template: 'password_changed', at: kstStamp(new Date()) });
  return true;
}

export type AdminConfirmResult = 'ok' | 'not_found' | 'password_not_set';

// 비밀번호가 없는 미인증 계정은 인증 처리를 거절한다(그렇게 확정하면 아무도 로그인하지 못하는 계정이 생긴다).
// 관리자는 어느 가입 시도가 본인 것인지 알 수 없으므로 시도를 골라 확정하지도 않는다 — 비밀번호 재설정 메일을 보낸다(링크를 쓰면 인증도 끝난다).
export async function confirmEmailAsAdmin(pool: pg.Pool, userId: string): Promise<AdminConfirmResult> {
  return withService(pool, async (tx) => {
    const r = await tx.query<{ email_confirmed_at: Date | null; encrypted_password: string | null }>(
      'select email_confirmed_at, encrypted_password from auth.users where id = $1 for update',
      [userId],
    );
    if (r.rowCount === 0) return 'not_found';
    const u = r.rows[0];
    if (u.email_confirmed_at) return 'ok'; // 이미 인증됨: 멱등
    if (!u.encrypted_password) return 'password_not_set';
    await tx.query('update auth.users set email_confirmed_at = now(), updated_at = now() where id = $1', [userId]);
    return 'ok';
  });
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
