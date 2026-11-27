import { createHash, randomBytes, randomInt } from 'node:crypto';
import { isIP } from 'node:net';
import type pg from 'pg';
import { withService, type Tx } from '../db/context.js';
import type { ErrorCode } from '../http/errors.js';
import type { MfaMode } from '../config.js';
import { kstStamp } from '../mail/kst.js';
import type { MailMessage } from '../mail/mailer.js';
import { codeHmac, decryptSecret, encryptSecret, hmacEquals, MfaKeyError, type MfaKeyring } from './mfa-crypto.js';
import { planAlertsIn, selfOnlySuffix, type AlertPlan } from './mfa-alerts.js';
import { reserveIn } from './rate-limit.js';
import { createSessionIn, revokeAllSessionsIn, revokeOtherSessionsIn, type MfaMethod } from './sessions.js';
import { base32Encode, matchStep, otpauthUri, SECRET_BYTES } from './totp.js';

// 관리자 2단계 인증(인증 앱 OTP)의 서버 로직. 계약: docs/02-design/features/bara-edu-lms.admin-totp.md 4장.
// 6자리 번호·복구 코드·등록 코드·대기표·비밀 키는 어떤 로그·오류·접속 기록에도 남기지 않는다(서버 로그는 종류와 userId만).
// 락 순서(tokens.ts): 사용자 다음에 mfa_challenges -> mfa_enroll_tickets -> mfa_enrollments -> (mfa-fail advisory) -> mfa_factors
//   -> mfa_recovery_codes -> mfa_account_state -> profiles.

export const VERIFY_TTL_SECONDS = 5 * 60;
export const ENROLL_CHALLENGE_TTL_SECONDS = 15 * 60;
export const ENROLLMENT_TTL_SECONDS = 10 * 60;
export const TICKET_TTL_SECONDS = 24 * 3600;
export const CHALLENGE_MAX_FAILS = 5;
export const ENROLLMENT_MAX_FAILS = 5;
export const TICKET_MAX_FAILS = 5;
export const TICKET_FAIL_BUCKET = 'mfa-ticket-fail';
export const TICKET_FAIL_WINDOW = 3600;
export const FAIL_BUCKET = 'mfa-fail';
export const FAIL_RELEASED_BUCKET = 'mfa-fail-released';
export const ACCOUNT_LIMIT = 10;
export const ACCOUNT_WINDOW = 15 * 60;
export const DAILY_LIMIT = 30;
export const DAILY_WINDOW = 24 * 3600;
export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const RECOVERY_RE = /^[2-9A-HJKMNP-Z]{10}$/;

export const MFA_ACTIONS = {
  login: '로그인',
  enrolled: '2단계인증등록',
  recoveryReissued: '복구코드재발급',
  reset: '2단계인증초기화',
  ticketIssued: '2단계인증등록코드발급',
  locked: '2단계인증잠김',
  unlocked: '2단계인증잠금해제',
} as const;

export const ADMIN_RESET_REASONS = ['lost_phone', 'new_phone', 'app_deleted', 'other'] as const;

// ---------- 결과 타입 ----------

export type Fail = { kind: 'fail'; code: ErrorCode; message: string; field?: string; extra?: Record<string, number | string | boolean> };
const fail = (code: ErrorCode, message: string, extra?: Fail['extra']): Fail => ({ kind: 'fail', code, message, ...(extra ? { extra } : {}) });

export type SessionOut = { sessionToken: string; expiresAt: Date; userId: string };
export type EnrollmentOut = { enrollmentId: string; otpauthUri: string; secretBase32: string; expiresAt: Date; entry: 'A' | 'B' | 'C' };

// 접속 기록 insert 실패: 트랜잭션 전체를 롤백하고 503 log_failed로 답한다.
export class LogFailed extends Error {}
// 키가 없거나(설정) 암호문이 풀리지 않음: 503 unavailable. 원인은 서버 로그에 종류만.
export class MfaUnavailable extends Error {}

export type MfaLog = { warn(obj: object, msg?: string): void; error(obj: object, msg?: string): void; info?(obj: object, msg?: string): void };

export type MfaDeps = {
  pool: pg.Pool;
  keyring: MfaKeyring | null;
  mode: MfaMode;
  alertTo: readonly string[];
  ttlDays: number;
  deliver(msg: MailMessage): void;
  log: MfaLog;
};

type LockState = { scope: 'account' | 'daily'; retryAfterMinutes: number };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const safeIp = (ip: string | null) => (ip !== null && isIP(ip) ? ip : null);

function ringOf(deps: { keyring: MfaKeyring | null }): MfaKeyring {
  if (!deps.keyring) throw new MfaUnavailable('mfa keyring not configured');
  return deps.keyring;
}

// ---------- 공통 도우미 ----------

export async function logIn(tx: Tx, adminId: string, targetId: string | null, action: string, detail: string, ip: string | null): Promise<void> {
  try {
    await tx.query('savepoint mfa_log');
    await tx.query('insert into admin_access_logs (admin_id, target_user_id, action, detail, ip_address) values ($1, $2, $3, $4, $5)', [adminId, targetId, action, detail, safeIp(ip)]);
    await tx.query('release savepoint mfa_log');
  } catch {
    throw new LogFailed('admin access log insert failed');
  }
}

type Account = { email: string; role: string | null; status: string | null; enrolled: boolean; everEnrolled: boolean; ticketRequired: boolean };

async function accountIn(tx: Tx, userId: string): Promise<Account | null> {
  const r = await tx.query<{ email: string; role: string | null; status: string | null; enrolled: boolean; ever: boolean; ticket: boolean }>(
    `select u.email, p.role::text as role, p.status::text as status,
            exists (select 1 from auth.mfa_factors f where f.user_id = u.id) as enrolled,
            coalesce(st.ever_enrolled_at is not null, false) as ever,
            coalesce(st.ticket_required_at is not null, false) as ticket
       from auth.users u
       left join public.profiles p on p.id = u.id
       left join auth.mfa_account_state st on st.user_id = u.id
      where u.id = $1`,
    [userId],
  );
  const a = r.rows[0];
  return a ? { email: a.email, role: a.role, status: a.status, enrolled: a.enrolled, everEnrolled: a.ever, ticketRequired: a.ticket } : null;
}

const isActiveAdmin = (a: Account | null) => !!a && a.role === 'admin' && a.status === 'active';

export async function touchStateIn(tx: Tx, userId: string, setSql: string): Promise<void> {
  await tx.query(
    `insert into auth.mfa_account_state as st (user_id) values ($1) on conflict (user_id) do nothing`,
    [userId],
  );
  await tx.query(`update auth.mfa_account_state set ${setSql}, updated_at = now() where user_id = $1`, [userId]);
}

// 이 사용자의 2단계 관련 행을 락 순서대로 잠근다(초기화·탈퇴·CLI처럼 여러 테이블을 지우는 경로).
export async function lockUserMfaIn(tx: Tx, userId: string): Promise<void> {
  await tx.query('select 1 from auth.mfa_challenges where user_id = $1 order by token_hash for update', [userId]);
  await tx.query('select 1 from auth.mfa_enroll_tickets where user_id = $1 for update', [userId]);
  await tx.query('select 1 from auth.mfa_enrollments where user_id = $1 for update', [userId]);
  await tx.query('select 1 from auth.mfa_factors where user_id = $1 for update', [userId]);
  await tx.query('select 1 from auth.mfa_recovery_codes where user_id = $1 order by id for update', [userId]);
  await tx.query('select 1 from auth.mfa_account_state where user_id = $1 for update', [userId]);
}

// 등록·대기·복구 코드·대기표·등록 코드를 지운다(lockUserMfaIn 뒤에 부른다). mfa_account_state는 남긴다.
export async function clearUserMfaIn(tx: Tx, userId: string): Promise<void> {
  await tx.query('delete from auth.mfa_challenges where user_id = $1', [userId]);
  await tx.query('delete from auth.mfa_enroll_tickets where user_id = $1', [userId]);
  await tx.query('delete from auth.mfa_enrollments where user_id = $1', [userId]);
  await tx.query('delete from auth.mfa_factors where user_id = $1', [userId]);
  await tx.query('delete from auth.mfa_recovery_codes where user_id = $1', [userId]);
}

// ---------- 시도 제한(기획서 2.9, 보안 점검 I-7) ----------

async function lockFailsIn(tx: Tx, userId: string): Promise<void> {
  await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${FAIL_BUCKET}:${userId}`]);
}

// 24시간 -> 15분 순서로 본다. retryAfterMinutes = 창 안의 실패가 한도 아래로 내려가는 시각까지(올림, 최소 1).
export async function lockStateIn(tx: Tx, userId: string): Promise<LockState | null> {
  const check = async (buckets: string[], limit: number, windowSeconds: number) => {
    const r = await tx.query<{ n: number }>(
      `select count(*)::int as n from auth.rate_events where key = $1 and bucket = any($2) and created_at > now() - make_interval(secs => $3::int)`,
      [userId, buckets, windowSeconds],
    );
    const n = r.rows[0].n;
    if (n < limit) return null;
    const t = await tx.query<{ m: number }>(
      `select greatest(1, ceil(extract(epoch from (created_at + make_interval(secs => $3::int) - now())) / 60))::int as m
         from auth.rate_events where key = $1 and bucket = any($2) and created_at > now() - make_interval(secs => $3::int)
        order by created_at, id offset $4 limit 1`,
      [userId, buckets, windowSeconds, n - limit],
    );
    return t.rows[0]?.m ?? 1;
  };
  const daily = await check([FAIL_BUCKET, FAIL_RELEASED_BUCKET], DAILY_LIMIT, DAILY_WINDOW);
  if (daily !== null) return { scope: 'daily', retryAfterMinutes: daily };
  const account = await check([FAIL_BUCKET], ACCOUNT_LIMIT, ACCOUNT_WINDOW);
  if (account !== null) return { scope: 'account', retryAfterMinutes: account };
  return null;
}

// 성공 시: 15분 창의 실패를 풀어 준다(bucket을 바꿔 24시간 누적에는 남긴다).
async function releaseRecentFailsIn(tx: Tx, userId: string): Promise<void> {
  await tx.query(
    `update auth.rate_events set bucket = $2 where key = $1 and bucket = $3 and created_at > now() - make_interval(secs => $4::int)`,
    [userId, FAIL_RELEASED_BUCKET, FAIL_BUCKET, ACCOUNT_WINDOW],
  );
}

const lockedFail = (l: LockState) => fail('rate_limited', 'mfa_locked', { lockScope: l.scope, retryAfterMinutes: l.retryAfterMinutes });

// 실패 1회 기록. 이번 실패로 잠기면(직전엔 안 잠김) 접속 기록·알림을 남기고 잠김 상태를 돌려준다.
async function recordFailIn(tx: Tx, deps: MfaDeps, userId: string, mails: MailMessage[]): Promise<LockState | null> {
  await tx.query('insert into auth.rate_events (bucket, key) values ($1, $2)', [FAIL_BUCKET, userId]);
  const locked = await lockStateIn(tx, userId);
  if (locked === null) return null;
  const at = kstStamp(new Date());
  const plan = await planAlertsIn(tx, userId, deps.alertTo, {
    own: { template: 'mfa_locked', at, scope: locked.scope, minutes: locked.scope === 'daily' ? 24 * 60 : ACCOUNT_WINDOW / 60 },
    alert: locked.scope === 'daily' ? 'locked_daily' : 'locked',
    at,
  });
  // 잠김 기록이 실패해도 429는 그대로 준다(잠김이 풀리면 안 된다). 기록 실패는 서버 오류 로그만.
  try {
    await logIn(tx, userId, userId, MFA_ACTIONS.locked, `limit=${locked.scope}${selfOnlySuffix(plan)}`, null);
  } catch {
    await tx.query('rollback to savepoint mfa_log').catch(() => {});
    deps.log.error({ event: 'mfa_lock_log_failed', userId }, 'mfa lock access log failed');
  }
  // 알림은 계정당 1시간에 1번(15분 한도와 24시간 한도는 따로 센다)
  if ((await reserveIn(tx, `mfa-lock-mail-${locked.scope}`, userId, 1, 3600)) !== null) mails.push(...plan.messages);
  return locked;
}

function logFail(deps: MfaDeps, userId: string | null, kind: 'wrong_code' | 'reused' | 'challenge_invalid' | 'ticket_invalid', ipKey: string | null): void {
  deps.log.warn({ event: 'mfa_fail', userId, kind, ipKey }, 'mfa fail');
}

// ---------- 인증 앱 번호·복구 코드 ----------

type CodeCheck = 'ok' | 'reused' | 'wrong' | 'no_factor';

// 등록된 인증 앱의 번호 확인(기획서 2.8). 행을 for update로 잠그고, 맞은 칸이 last_used_step보다 크면 성공(칸 갱신), 이하면 재사용.
async function checkFactorCodeIn(tx: Tx, ring: MfaKeyring, userId: string, code: string): Promise<CodeCheck> {
  const r = await tx.query<{ secret_ciphertext: Buffer; secret_iv: Buffer; key_version: number; last_used_step: string }>(
    'select secret_ciphertext, secret_iv, key_version, last_used_step from auth.mfa_factors where user_id = $1 for update',
    [userId],
  );
  if (r.rowCount === 0) return 'no_factor';
  const f = r.rows[0];
  let secret: Buffer;
  try {
    secret = decryptSecret(ring, userId, 'factor', { ciphertext: f.secret_ciphertext, iv: f.secret_iv, keyVersion: f.key_version });
  } catch (err) {
    throw new MfaUnavailable(err instanceof MfaKeyError ? 'factor decrypt failed' : 'factor decrypt error');
  }
  const s = matchStep(secret, code, Date.now());
  secret.fill(0);
  if (s === null) return 'wrong';
  if (s <= Number(f.last_used_step)) return 'reused';
  await tx.query('update auth.mfa_factors set last_used_step = $2, last_used_at = now() where user_id = $1', [userId, s]);
  return 'ok';
}

export function normalizeRecoveryCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

// 복구 코드 1개를 원자적으로 소모한다(조회 뒤 갱신 금지). 남은 개수 또는 null(틀림·이미 씀·형식 아님).
async function consumeRecoveryIn(tx: Tx, ring: MfaKeyring, userId: string, raw: string): Promise<number | null> {
  const norm = normalizeRecoveryCode(raw);
  if (!RECOVERY_RE.test(norm)) return null;
  const versions = await tx.query<{ key_version: number }>(
    'select distinct key_version from auth.mfa_recovery_codes where user_id = $1 and used_at is null',
    [userId],
  );
  const hmacs: Buffer[] = [];
  for (const { key_version } of versions.rows) {
    try {
      hmacs.push(codeHmac(ring, key_version, 'recovery-code', norm));
    } catch {
      // 그 버전의 키가 설정에서 빠졌다(2.6 키 교체 절차 위반). 이 버전의 코드는 맞출 수 없다.
    }
  }
  if (hmacs.length === 0) return null;
  const u = await tx.query(
    'update auth.mfa_recovery_codes set used_at = now() where user_id = $1 and code_hmac = any($2::bytea[]) and used_at is null returning id',
    [userId, hmacs],
  );
  if (u.rowCount === 0) return null;
  const left = await tx.query<{ n: number }>('select count(*)::int as n from auth.mfa_recovery_codes where user_id = $1 and used_at is null', [userId]);
  return left.rows[0].n;
}

function newRecoveryCode(): string {
  let s = '';
  for (let i = 0; i < 10; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

// 새 복구 코드 10개(현재 키 버전). 옛 코드는 모두 지운다.
async function issueRecoveryCodesIn(tx: Tx, ring: MfaKeyring, userId: string): Promise<string[]> {
  await tx.query('delete from auth.mfa_recovery_codes where user_id = $1', [userId]);
  const codes: string[] = [];
  while (codes.length < RECOVERY_CODE_COUNT) {
    const c = newRecoveryCode();
    if (codes.includes(c)) continue;
    codes.push(c);
    await tx.query('insert into auth.mfa_recovery_codes (user_id, code_hmac, key_version) values ($1, $2, $3)', [
      userId, codeHmac(ring, ring.current, 'recovery-code', normalizeRecoveryCode(c)), ring.current,
    ]);
  }
  await touchStateIn(tx, userId, 'recovery_codes_issued_at = now()');
  return codes;
}

// ---------- 대기표 ----------

type Challenge = { token_hash: string; user_id: string; purpose: 'verify' | 'enroll'; fail_count: number; ticket_verified_at: Date | null };

async function issueChallengeIn(tx: Tx, userId: string, purpose: 'verify' | 'enroll', ip: string | null): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const r = await tx.query<{ expires_at: Date }>(
    `insert into auth.mfa_challenges (token_hash, user_id, purpose, ip, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(secs => $5::int)) returning expires_at`,
    [sha256(token), userId, purpose, safeIp(ip), purpose === 'verify' ? VERIFY_TTL_SECONDS : ENROLL_CHALLENGE_TTL_SECONDS],
  );
  return { token, expiresAt: r.rows[0].expires_at };
}

async function lockChallengeIn(tx: Tx, token: string, purpose: 'verify' | 'enroll'): Promise<Challenge | null> {
  const r = await tx.query<Challenge>(
    `select token_hash, user_id, purpose, fail_count, ticket_verified_at from auth.mfa_challenges
      where token_hash = $1 and used_at is null and expires_at > now() for update`,
    [sha256(token)],
  );
  const c = r.rows[0];
  return c && c.purpose === purpose ? c : null;
}

const dropChallengeIn = (tx: Tx, c: Challenge) => tx.query('delete from auth.mfa_challenges where token_hash = $1', [c.token_hash]);

// ---------- 로그인(4.1) ----------

export type AdminLoginOutcome =
  | { kind: 'session'; session: SessionOut }
  | { kind: 'challenge'; mfa: 'required' | 'enroll_required'; challengeToken: string; challengeExpiresAt: Date; enrollReason?: 'first' | 'reset' };

// 비밀번호가 맞고 인증 완료된 계정의 세션 또는 대기표(2.2 로그인 분기). 관리자가 아니면 기존과 같은 세션.
export async function loginOutcomeIn(tx: Tx, userId: string, opts: { mode: MfaMode; ttlDays: number; ip: string | null }): Promise<AdminLoginOutcome> {
  await lockUserMfaStateForLoginIn(tx, userId);
  const a = await accountIn(tx, userId);
  if (!a || a.role !== 'admin') {
    const s = await createSessionIn(tx, userId, opts.ttlDays);
    return { kind: 'session', session: { sessionToken: s.token, expiresAt: s.expiresAt, userId } };
  }
  const passwordOnly = async () => {
    const s = await createSessionIn(tx, userId, opts.ttlDays);
    await logIn(tx, userId, userId, MFA_ACTIONS.login, `mfa=none;mode=${opts.mode}`, opts.ip);
    return { kind: 'session' as const, session: { sessionToken: s.token, expiresAt: s.expiresAt, userId } };
  };
  if (a.enrolled) {
    if (opts.mode === 'off') return passwordOnly();
    const c = await issueChallengeIn(tx, userId, 'verify', opts.ip);
    return { kind: 'challenge', mfa: 'required', challengeToken: c.token, challengeExpiresAt: c.expiresAt };
  }
  if (!a.ticketRequired && opts.mode !== 'enforce') return passwordOnly();
  // enforce인데 한 번도 등록·발급 이력이 없는 계정: 이후 유예로 되돌려도 입구 A가 열리지 않게 표시한다(2.2)
  if (!a.ticketRequired) await touchStateIn(tx, userId, 'ticket_required_at = coalesce(ticket_required_at, now())');
  const c = await issueChallengeIn(tx, userId, 'enroll', opts.ip);
  return { kind: 'challenge', mfa: 'enroll_required', challengeToken: c.token, challengeExpiresAt: c.expiresAt, enrollReason: a.everEnrolled ? 'reset' : 'first' };
}

async function lockUserMfaStateForLoginIn(tx: Tx, userId: string): Promise<void> {
  // 같은 계정의 초기화·등록 확정과 겹칠 때 등록 여부를 확정된 값으로 읽는다(공유 잠금).
  await tx.query('select 1 from auth.mfa_factors where user_id = $1 for share', [userId]);
  await tx.query('select 1 from auth.mfa_account_state where user_id = $1 for share', [userId]);
}

// ---------- 4.2 verify / 4.3 recover ----------

async function wrongOnChallengeIn(tx: Tx, deps: MfaDeps, c: Challenge, mails: MailMessage[]): Promise<Fail> {
  const u = await tx.query<{ fail_count: number }>('update auth.mfa_challenges set fail_count = fail_count + 1 where token_hash = $1 returning fail_count', [c.token_hash]);
  const fails = u.rows[0].fail_count;
  const locked = await recordFailIn(tx, deps, c.user_id, mails);
  if (fails >= CHALLENGE_MAX_FAILS) await dropChallengeIn(tx, c);
  if (locked) return lockedFail(locked);
  if (fails >= CHALLENGE_MAX_FAILS) return fail('unauthenticated', 'challenge_exhausted');
  return fail('forbidden', 'wrong_code', { attemptsLeft: CHALLENGE_MAX_FAILS - fails });
}

async function runWithMails<T>(deps: MfaDeps, fn: (tx: Tx, mails: MailMessage[]) => Promise<T>): Promise<T> {
  const mails: MailMessage[] = [];
  const out = await withService(deps.pool, (tx) => fn(tx, mails));
  for (const m of mails) deps.deliver(m); // 커밋된 뒤에만
  return out;
}

export async function verifyMfa(deps: MfaDeps, input: { challengeToken: string; code: string; ip: string | null; ipKey: string | null }): Promise<SessionOut | Fail> {
  const ring = ringOf(deps);
  return runWithMails(deps, async (tx, mails) => {
    const c = await lockChallengeIn(tx, input.challengeToken, 'verify');
    if (!c) {
      logFail(deps, null, 'challenge_invalid', input.ipKey);
      return fail('unauthenticated', 'challenge_invalid');
    }
    await lockFailsIn(tx, c.user_id);
    const locked = await lockStateIn(tx, c.user_id);
    if (locked) return lockedFail(locked);
    const a = await accountIn(tx, c.user_id);
    if (!isActiveAdmin(a) || !a!.enrolled || deps.mode === 'off') {
      await dropChallengeIn(tx, c);
      return fail('unauthenticated', 'account_changed');
    }
    const r = await checkFactorCodeIn(tx, ring, c.user_id, input.code);
    if (r === 'reused') {
      logFail(deps, c.user_id, 'reused', input.ipKey);
      return fail('forbidden', 'code_reused', { attemptsLeft: CHALLENGE_MAX_FAILS - c.fail_count });
    }
    if (r !== 'ok') {
      logFail(deps, c.user_id, 'wrong_code', input.ipKey);
      return wrongOnChallengeIn(tx, deps, c, mails);
    }
    await releaseRecentFailsIn(tx, c.user_id);
    await tx.query('update auth.mfa_challenges set used_at = now() where token_hash = $1', [c.token_hash]);
    const s = await createSessionIn(tx, c.user_id, deps.ttlDays, { mfaMethod: 'totp' });
    await logIn(tx, c.user_id, c.user_id, MFA_ACTIONS.login, 'mfa=totp', input.ip);
    return { sessionToken: s.token, expiresAt: s.expiresAt, userId: c.user_id };
  });
}

export async function recoverMfa(
  deps: MfaDeps,
  input: { challengeToken: string; recoveryCode: string; ip: string | null; ipKey: string | null },
): Promise<(SessionOut & { recoveryCodesLeft: number }) | Fail> {
  const ring = ringOf(deps);
  return runWithMails(deps, async (tx, mails) => {
    const c = await lockChallengeIn(tx, input.challengeToken, 'verify');
    if (!c) {
      logFail(deps, null, 'challenge_invalid', input.ipKey);
      return fail('unauthenticated', 'challenge_invalid');
    }
    await lockFailsIn(tx, c.user_id);
    const locked = await lockStateIn(tx, c.user_id);
    if (locked) return lockedFail(locked);
    const a = await accountIn(tx, c.user_id);
    if (!isActiveAdmin(a) || !a!.enrolled || deps.mode === 'off') {
      await dropChallengeIn(tx, c);
      return fail('unauthenticated', 'account_changed');
    }
    const left = await consumeRecoveryIn(tx, ring, c.user_id, input.recoveryCode);
    if (left === null) {
      logFail(deps, c.user_id, 'wrong_code', input.ipKey);
      return wrongOnChallengeIn(tx, deps, c, mails);
    }
    await releaseRecentFailsIn(tx, c.user_id);
    await tx.query('update auth.mfa_challenges set used_at = now() where token_hash = $1', [c.token_hash]);
    const s = await createSessionIn(tx, c.user_id, deps.ttlDays, { mfaMethod: 'recovery' });
    const at = kstStamp(new Date());
    const plan = await planAlertsIn(tx, c.user_id, deps.alertTo, { own: { template: 'mfa_recovery_used', at, left }, alert: 'recovery_used', at, left });
    await logIn(tx, c.user_id, c.user_id, MFA_ACTIONS.login, `mfa=recovery;left=${left}${selfOnlySuffix(plan)}`, input.ip);
    mails.push(...plan.messages);
    return { sessionToken: s.token, expiresAt: s.expiresAt, userId: c.user_id, recoveryCodesLeft: left };
  });
}

// ---------- 4.4 등록 ----------

type Ticket = { user_id: string; code_hmac: Buffer; key_version: number; fail_count: number; enrollment_id: string | null; verified_at: Date | null; usable: boolean };

async function lockTicketIn(tx: Tx, userId: string): Promise<Ticket | null> {
  const r = await tx.query<Ticket>(
    `select user_id, code_hmac, key_version, fail_count, enrollment_id, verified_at,
            (used_at is null and expires_at > now() and fail_count < $2) as usable
       from auth.mfa_enroll_tickets where user_id = $1 for update`,
    [userId, TICKET_MAX_FAILS],
  );
  return r.rows[0] ?? null;
}

export async function checkEnrollTicket(
  deps: MfaDeps,
  input: { challengeToken: string; enrollTicket: string; ipKey: string | null },
): Promise<{ ok: true } | Fail> {
  const ring = ringOf(deps);
  return runWithMails(deps, async (tx) => {
    const c = await lockChallengeIn(tx, input.challengeToken, 'enroll');
    if (!c) {
      logFail(deps, null, 'challenge_invalid', input.ipKey);
      return fail('unauthenticated', 'challenge_invalid');
    }
    const a = await accountIn(tx, c.user_id);
    if (!isActiveAdmin(a) || a!.enrolled) {
      await dropChallengeIn(tx, c);
      return fail('unauthenticated', 'account_changed');
    }
    const t = await lockTicketIn(tx, c.user_id);
    const recent = await tx.query<{ n: number }>(
      `select count(*)::int as n from auth.rate_events where bucket = $1 and key = $2 and created_at > now() - make_interval(secs => $3::int)`,
      [TICKET_FAIL_BUCKET, c.user_id, TICKET_FAIL_WINDOW],
    );
    if (!t || !t.usable || recent.rows[0].n >= TICKET_MAX_FAILS) return fail('conflict', 'ticket_unusable');
    let expected: Buffer;
    try {
      expected = codeHmac(ring, t.key_version, 'enroll-ticket', input.enrollTicket);
    } catch {
      throw new MfaUnavailable('ticket key version not loaded');
    }
    if (hmacEquals(expected, t.code_hmac)) {
      await tx.query('update auth.mfa_enroll_tickets set verified_at = now() where user_id = $1', [c.user_id]);
      await tx.query('update auth.mfa_challenges set ticket_verified_at = now() where token_hash = $1', [c.token_hash]);
      return { ok: true as const };
    }
    logFail(deps, c.user_id, 'ticket_invalid', input.ipKey);
    const u = await tx.query<{ fail_count: number }>('update auth.mfa_enroll_tickets set fail_count = fail_count + 1 where user_id = $1 returning fail_count', [c.user_id]);
    await tx.query('insert into auth.rate_events (bucket, key) values ($1, $2)', [TICKET_FAIL_BUCKET, c.user_id]);
    const left = Math.min(TICKET_MAX_FAILS - u.rows[0].fail_count, TICKET_MAX_FAILS - (recent.rows[0].n + 1));
    if (left <= 0) return fail('conflict', 'ticket_unusable');
    return fail('forbidden', 'ticket_invalid', { attemptsLeft: left });
  });
}

type EnrollmentRow = {
  id: string;
  user_id: string;
  challenge_hash: string | null;
  session_hash: string | null;
  entry: 'A' | 'B' | 'C';
  replace_check: 'totp' | 'recovery' | null;
  secret_ciphertext: Buffer;
  secret_iv: Buffer;
  key_version: number;
  fail_count: number;
  expires_at: Date;
  live: boolean;
};

const ENROLLMENT_COLS = 'id, user_id, challenge_hash, session_hash, entry, replace_check, secret_ciphertext, secret_iv, key_version, fail_count, expires_at, expires_at > now() as live';

function enrollmentOut(ring: MfaKeyring, e: EnrollmentRow, email: string): EnrollmentOut {
  let secret: Buffer;
  try {
    secret = decryptSecret(ring, e.user_id, 'enrollment', { ciphertext: e.secret_ciphertext, iv: e.secret_iv, keyVersion: e.key_version });
  } catch {
    throw new MfaUnavailable('enrollment decrypt failed');
  }
  const b32 = base32Encode(secret);
  secret.fill(0);
  return { enrollmentId: e.id, otpauthUri: otpauthUri(email, b32), secretBase32: b32, expiresAt: e.expires_at, entry: e.entry };
}

async function createEnrollmentIn(
  tx: Tx,
  ring: MfaKeyring,
  userId: string,
  entry: 'A' | 'B' | 'C',
  opts: { challengeHash?: string; replaceCheck?: 'totp' | 'recovery'; sessionHash?: string },
): Promise<EnrollmentRow> {
  await tx.query('delete from auth.mfa_enrollments where user_id = $1', [userId]); // 사용자당 1개
  const secret = randomBytes(SECRET_BYTES);
  const sealed = encryptSecret(ring, userId, 'enrollment', secret);
  secret.fill(0);
  const r = await tx.query<EnrollmentRow>(
    `insert into auth.mfa_enrollments (user_id, challenge_hash, entry, replace_check, secret_ciphertext, secret_iv, key_version, expires_at, session_hash)
     values ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8::int), $9) returning ${ENROLLMENT_COLS}`,
    [userId, opts.challengeHash ?? null, entry, opts.replaceCheck ?? null, sealed.ciphertext, sealed.iv, sealed.keyVersion, ENROLLMENT_TTL_SECONDS, opts.sessionHash ?? null],
  );
  return r.rows[0];
}

export type StartInput =
  | { via: 'challenge'; challengeToken: string; renew: boolean; ipKey: string | null }
  | { via: 'session'; userId: string; sessionToken: string; renew: boolean; currentCode?: string; recoveryCode?: string; ipKey: string | null };

export async function startEnrollment(deps: MfaDeps, input: StartInput): Promise<EnrollmentOut | Fail> {
  const ring = ringOf(deps);
  return runWithMails(deps, async (tx, mails) => {
    if (input.via === 'challenge') {
      const c = await lockChallengeIn(tx, input.challengeToken, 'enroll');
      if (!c) {
        logFail(deps, null, 'challenge_invalid', input.ipKey);
        return fail('unauthenticated', 'challenge_invalid');
      }
      const a = await accountIn(tx, c.user_id);
      if (!isActiveAdmin(a) || a!.enrolled) {
        await dropChallengeIn(tx, c);
        return fail('unauthenticated', 'account_changed');
      }
      if (!c.ticket_verified_at) return fail('forbidden', 'ticket_not_verified');
      const t = await lockTicketIn(tx, c.user_id);
      if (!t || !t.usable || !t.verified_at) return fail('conflict', 'ticket_unusable');
      const ex = await tx.query<EnrollmentRow>(`select ${ENROLLMENT_COLS} from auth.mfa_enrollments where user_id = $1 for update`, [c.user_id]);
      const e0 = ex.rows[0];
      if (e0 && e0.challenge_hash === c.token_hash && e0.live && !input.renew) return enrollmentOut(ring, e0, a!.email);
      const e = await createEnrollmentIn(tx, ring, c.user_id, 'B', { challengeHash: c.token_hash });
      await tx.query('update auth.mfa_enroll_tickets set enrollment_id = $2 where user_id = $1', [c.user_id, e.id]);
      return enrollmentOut(ring, e, a!.email);
    }

    const userId = input.userId;
    const replace = input.currentCode !== undefined || input.recoveryCode !== undefined;
    if (replace) {
      // 입구 C는 이 세션에 묶이므로(session_hash FK) 세션 행을 먼저 for key share로 잡는다(01-auth.sql 잠금 순서 sessions -> mfa_enrollments).
      // 그 사이 로그아웃·정리로 세션이 지워졌으면 FK 오류(500) 대신 401(QA Minor 1). 잡은 뒤에는 커밋 때까지 지워지지 않는다.
      const s = await tx.query('select 1 from auth.sessions where token_hash = $1 for key share', [sha256(input.sessionToken)]);
      if (s.rowCount === 0) return fail('unauthenticated', 'session_ended');
    }
    // 락 순서: (세션) -> 등록 대기 -> (mfa-fail) -> 등록
    const ex = await tx.query<EnrollmentRow>(`select ${ENROLLMENT_COLS} from auth.mfa_enrollments where user_id = $1 for update`, [userId]);
    const a = await accountIn(tx, userId);
    if (!a || a.role !== 'admin') return fail('forbidden', 'not_admin');
    if (!replace) {
      // 입구 A: 한 번도 등록한 적 없고 등록 코드도 요구되지 않는 계정만(모든 모드, 보안 점검 I-1)
      if (a.enrolled) return fail('conflict', 'already_enrolled');
      if (a.ticketRequired) return fail('conflict', 'ticket_required');
      const e0 = ex.rows[0];
      if (e0 && e0.entry === 'A' && e0.live && !input.renew) return enrollmentOut(ring, e0, a.email);
      return enrollmentOut(ring, await createEnrollmentIn(tx, ring, userId, 'A', {}), a.email);
    }
    // 입구 C: 지금 인증 앱의 6자리 또는 아직 쓰지 않은 복구 코드 1개로 재확인(보안 점검 I-4). 세션만으로는 바꿀 수 없다.
    if (!a.enrolled) return fail('conflict', 'not_enrolled');
    await lockFailsIn(tx, userId);
    const locked = await lockStateIn(tx, userId);
    if (locked) return lockedFail(locked);
    let check: 'totp' | 'recovery';
    if (input.currentCode !== undefined) {
      check = 'totp';
      const r = await checkFactorCodeIn(tx, ring, userId, input.currentCode);
      if (r === 'reused') {
        logFail(deps, userId, 'reused', input.ipKey);
        return fail('forbidden', 'code_reused');
      }
      if (r !== 'ok') {
        logFail(deps, userId, 'wrong_code', input.ipKey);
        const l = await recordFailIn(tx, deps, userId, mails);
        return l ? lockedFail(l) : fail('forbidden', 'wrong_code');
      }
    } else {
      check = 'recovery';
      await tx.query('select 1 from auth.mfa_factors where user_id = $1 for update', [userId]);
      const left = await consumeRecoveryIn(tx, ring, userId, input.recoveryCode!);
      if (left === null) {
        logFail(deps, userId, 'wrong_code', input.ipKey);
        const l = await recordFailIn(tx, deps, userId, mails);
        return l ? lockedFail(l) : fail('forbidden', 'wrong_code');
      }
      const at = kstStamp(new Date());
      const plan = await planAlertsIn(tx, userId, deps.alertTo, { own: { template: 'mfa_recovery_used', at, left }, alert: 'recovery_used', at, left });
      mails.push(...plan.messages);
    }
    await releaseRecentFailsIn(tx, userId);
    return enrollmentOut(ring, await createEnrollmentIn(tx, ring, userId, 'C', { replaceCheck: check, sessionHash: sha256(input.sessionToken) }), a.email);
  });
}

export async function currentEnrollment(
  deps: MfaDeps,
  input: { via: 'challenge'; challengeToken: string } | { via: 'session'; userId: string; sessionToken: string },
): Promise<EnrollmentOut | Fail> {
  const ring = ringOf(deps);
  return withService(deps.pool, async (tx) => {
    if (input.via === 'challenge') {
      const c = await lockChallengeIn(tx, input.challengeToken, 'enroll');
      if (!c) return fail('unauthenticated', 'challenge_invalid');
      const a = await accountIn(tx, c.user_id);
      if (!isActiveAdmin(a) || a!.enrolled) return fail('unauthenticated', 'account_changed');
      const e = await tx.query<EnrollmentRow>(`select ${ENROLLMENT_COLS} from auth.mfa_enrollments where challenge_hash = $1`, [c.token_hash]);
      if (!e.rows[0]?.live) return fail('not_found', 'no_enrollment', { ticketVerified: c.ticket_verified_at !== null });
      return enrollmentOut(ring, e.rows[0], a!.email);
    }
    const a = await accountIn(tx, input.userId);
    if (!a || a.role !== 'admin') return fail('forbidden', 'not_admin');
    // 입구 C는 시작한 세션에서만 다시 읽는다(보안 점검 m-1). A는 세션 사용자 기준 그대로.
    const e = await tx.query<EnrollmentRow>(
      `select ${ENROLLMENT_COLS} from auth.mfa_enrollments where user_id = $1 and challenge_hash is null and (entry <> 'C' or session_hash = $2)`,
      [input.userId, sha256(input.sessionToken)],
    );
    if (!e.rows[0]?.live) return fail('not_found', 'no_enrollment');
    return enrollmentOut(ring, e.rows[0], a.email);
  });
}

export type ConfirmInput = {
  enrollmentId: string;
  code: string;
  rotateRecoveryCodes: boolean;
  ip: string | null;
} & ({ via: 'challenge'; challengeToken: string } | { via: 'session'; userId: string; sessionToken: string });

export type ConfirmOut = { recoveryCodes: string[] | null; session: SessionOut | null };

export async function confirmEnrollment(deps: MfaDeps, input: ConfirmInput): Promise<ConfirmOut | Fail> {
  const ring = ringOf(deps);
  return runWithMails(deps, async (tx, mails) => {
    let c: Challenge | null = null;
    let owner: string;
    let ticket: Ticket | null = null;
    if (input.via === 'challenge') {
      c = await lockChallengeIn(tx, input.challengeToken, 'enroll');
      if (!c) return fail('unauthenticated', 'challenge_invalid');
      owner = c.user_id;
      ticket = await lockTicketIn(tx, owner);
    } else owner = input.userId;

    const er = await tx.query<EnrollmentRow>(`select ${ENROLLMENT_COLS} from auth.mfa_enrollments where id = $1 for update`, [input.enrollmentId]);
    const e = er.rows[0];
    // 등록 묶기(보안 점검 M-2): B는 이 대기표, A·C는 세션 사용자. 다른 사람·다른 대기표의 등록 대기는 없는 것으로 본다.
    if (!e || e.user_id !== owner || (c ? e.challenge_hash !== c.token_hash : e.challenge_hash !== null)) return fail('not_found', 'not_found');
    // 입구 C는 시작한 세션에서만 확정한다(보안 점검 m-1).
    if (!c && e.entry === 'C' && input.via === 'session' && e.session_hash !== sha256(input.sessionToken)) return fail('not_found', 'not_found');
    if (!e.live) {
      await tx.query('delete from auth.mfa_enrollments where id = $1', [e.id]);
      return fail('conflict', 'enrollment_expired');
    }
    const a = await accountIn(tx, owner);
    if (!isActiveAdmin(a)) {
      if (c) {
        await dropChallengeIn(tx, c);
        return fail('unauthenticated', 'account_changed');
      }
      return fail('forbidden', 'not_admin');
    }
    if (e.entry !== 'C' && a!.enrolled) {
      await tx.query('delete from auth.mfa_enrollments where id = $1', [e.id]);
      return fail('conflict', 'already_enrolled');
    }
    if (e.entry === 'A' && a!.ticketRequired) return fail('conflict', 'ticket_required');
    if (e.entry === 'B' && (!ticket || !ticket.usable || !ticket.verified_at || ticket.enrollment_id !== e.id)) return fail('conflict', 'ticket_unusable');
    if (e.entry === 'C' && !a!.enrolled) return fail('conflict', 'not_enrolled');

    await tx.query('select 1 from auth.mfa_factors where user_id = $1 for update', [owner]);
    let secret: Buffer;
    try {
      secret = decryptSecret(ring, owner, 'enrollment', { ciphertext: e.secret_ciphertext, iv: e.secret_iv, keyVersion: e.key_version });
    } catch {
      throw new MfaUnavailable('enrollment decrypt failed');
    }
    const step = matchStep(secret, input.code, Date.now());
    if (step === null) {
      secret.fill(0);
      const u = await tx.query<{ fail_count: number }>('update auth.mfa_enrollments set fail_count = fail_count + 1 where id = $1 returning fail_count', [e.id]);
      const fails = u.rows[0].fail_count;
      if (fails >= ENROLLMENT_MAX_FAILS) {
        await tx.query('delete from auth.mfa_enrollments where id = $1', [e.id]);
        return fail('conflict', 'enrollment_expired');
      }
      return fail('forbidden', 'wrong_code', { attemptsLeft: ENROLLMENT_MAX_FAILS - fails });
    }

    // 확정: 새 IV·AAD 용도 factor로 다시 암호화한다(보안 점검 M-4)
    const sealed = encryptSecret(ring, owner, 'factor', secret);
    secret.fill(0);
    const via = e.entry === 'A' ? 'session' : e.entry === 'B' ? 'ticket' : 'replace';
    await tx.query(
      `insert into auth.mfa_factors (user_id, secret_ciphertext, secret_iv, key_version, confirmed_at, last_used_step, last_used_at, enrolled_via, enrolled_ip)
       values ($1, $2, $3, $4, now(), $5, now(), $6, $7)
       on conflict (user_id) do update set secret_ciphertext = excluded.secret_ciphertext, secret_iv = excluded.secret_iv,
         key_version = excluded.key_version, confirmed_at = excluded.confirmed_at, last_used_step = excluded.last_used_step,
         last_used_at = excluded.last_used_at, enrolled_via = excluded.enrolled_via, enrolled_ip = excluded.enrolled_ip, created_at = now()`,
      [owner, sealed.ciphertext, sealed.iv, sealed.keyVersion, step, via, safeIp(input.ip)],
    );
    const rotate = e.entry !== 'C' || input.rotateRecoveryCodes;
    const codes = rotate ? await issueRecoveryCodesIn(tx, ring, owner) : null;
    await touchStateIn(tx, owner, 'ever_enrolled_at = coalesce(ever_enrolled_at, now()), ticket_required_at = coalesce(ticket_required_at, now())');

    let session: SessionOut | null = null;
    if (e.entry === 'B') {
      await tx.query('update auth.mfa_enroll_tickets set used_at = now() where user_id = $1', [owner]);
      await tx.query('update auth.mfa_challenges set used_at = now() where token_hash = $1', [c!.token_hash]);
    }
    if (e.entry === 'A') await revokeAllSessionsIn(tx, owner); // 비밀번호만의 세션을 승격하지 않는다(보안 점검 I-2)
    if (e.entry === 'A' || e.entry === 'B') {
      const s = await createSessionIn(tx, owner, deps.ttlDays, { mfaMethod: 'enroll' });
      session = { sessionToken: s.token, expiresAt: s.expiresAt, userId: owner };
    }
    if (e.entry === 'C' && input.via === 'session') await revokeOtherSessionsIn(tx, owner, input.sessionToken);

    const at = kstStamp(new Date());
    const plan = await planAlertsIn(tx, owner, deps.alertTo, { own: { template: 'mfa_enrolled', at }, alert: 'enrolled', at });
    const detail = e.entry === 'C' ? `via=replace;check=${e.replace_check}` : `via=${via}`;
    await logIn(tx, owner, owner, MFA_ACTIONS.enrolled, `${detail}${selfOnlySuffix(plan)}`, input.ip);
    if (session) await logIn(tx, owner, owner, MFA_ACTIONS.login, 'mfa=enroll', input.ip);
    if (e.entry === 'C' && codes) await logIn(tx, owner, owner, MFA_ACTIONS.recoveryReissued, `count=${RECOVERY_CODE_COUNT};via=replace`, input.ip);
    await tx.query('delete from auth.mfa_enrollments where id = $1', [e.id]);
    mails.push(...plan.messages);
    return { recoveryCodes: codes, session };
  });
}

// ---------- 4.5 로그인 후 ----------

export type MfaStatus = {
  mode: MfaMode;
  enrolled: boolean;
  enrolledAt: string | null;
  lastUsedAt: string | null;
  recoveryCodesLeft: number;
  recoveryCodesAcked: boolean;
  canSelfEnroll: boolean;
  graceUntil: string | null;
  signedInWithRecovery: boolean;
  sessionExpiresAt: string;
};

export async function mfaStatus(
  deps: Pick<MfaDeps, 'pool' | 'mode'> & { graceUntil: string | null },
  userId: string,
  session: { expiresAt: Date; mfaMethod: MfaMethod | null },
): Promise<MfaStatus | Fail> {
  return withService(deps.pool, async (tx) => {
    const r = await tx.query<{
      role: string | null;
      confirmed_at: Date | null;
      last_used_at: Date | null;
      left: number;
      ticket: boolean;
      issued: Date | null;
      acked: Date | null;
    }>(
      `select p.role::text as role, f.confirmed_at, f.last_used_at,
              (select count(*)::int from auth.mfa_recovery_codes rc where rc.user_id = u.id and rc.used_at is null) as left,
              coalesce(st.ticket_required_at is not null, false) as ticket,
              st.recovery_codes_issued_at as issued, st.recovery_codes_acked_at as acked
         from auth.users u
         left join public.profiles p on p.id = u.id
         left join auth.mfa_factors f on f.user_id = u.id
         left join auth.mfa_account_state st on st.user_id = u.id
        where u.id = $1`,
      [userId],
    );
    const row = r.rows[0];
    if (!row || row.role !== 'admin') return fail('forbidden', 'not_admin');
    const enrolled = row.confirmed_at !== null;
    return {
      mode: deps.mode,
      enrolled,
      enrolledAt: row.confirmed_at?.toISOString() ?? null,
      lastUsedAt: row.last_used_at?.toISOString() ?? null,
      recoveryCodesLeft: row.left,
      recoveryCodesAcked: !enrolled || row.issued === null || (row.acked !== null && row.acked >= row.issued),
      canSelfEnroll: !enrolled && !row.ticket,
      graceUntil: deps.mode === 'optional' ? deps.graceUntil : null,
      signedInWithRecovery: session.mfaMethod === 'recovery',
      sessionExpiresAt: session.expiresAt.toISOString(),
    };
  });
}

export async function regenerateRecoveryCodes(deps: MfaDeps, input: { userId: string; code: string; ip: string | null; ipKey: string | null }): Promise<{ recoveryCodes: string[] } | Fail> {
  const ring = ringOf(deps);
  return runWithMails(deps, async (tx, mails) => {
    const a = await accountIn(tx, input.userId);
    if (!a || a.role !== 'admin') return fail('forbidden', 'not_admin');
    if (!a.enrolled) return fail('conflict', 'not_enrolled');
    await lockFailsIn(tx, input.userId);
    const locked = await lockStateIn(tx, input.userId);
    if (locked) return lockedFail(locked);
    const r = await checkFactorCodeIn(tx, ring, input.userId, input.code);
    if (r === 'no_factor') return fail('conflict', 'not_enrolled');
    if (r === 'reused') {
      logFail(deps, input.userId, 'reused', input.ipKey);
      return fail('forbidden', 'code_reused');
    }
    if (r === 'wrong') {
      logFail(deps, input.userId, 'wrong_code', input.ipKey);
      const l = await recordFailIn(tx, deps, input.userId, mails);
      return l ? lockedFail(l) : fail('forbidden', 'wrong_code');
    }
    await releaseRecentFailsIn(tx, input.userId);
    const codes = await issueRecoveryCodesIn(tx, ring, input.userId);
    await logIn(tx, input.userId, input.userId, MFA_ACTIONS.recoveryReissued, `count=${RECOVERY_CODE_COUNT}`, input.ip);
    return { recoveryCodes: codes };
  });
}

export async function ackRecoveryCodes(pool: pg.Pool, userId: string): Promise<{ ok: true } | Fail> {
  return withService(pool, async (tx) => {
    const a = await accountIn(tx, userId);
    if (!a || a.role !== 'admin') return fail('forbidden', 'not_admin');
    await touchStateIn(tx, userId, 'recovery_codes_acked_at = now()');
    return { ok: true as const };
  });
}

// ---------- 초기화·등록 코드(4.6.1, 2.7) ----------

export function newEnrollTicketCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, '0');
}

// 등록 코드 1개 발급(기존 것은 덮어씀, 24시간, HMAC + 현재 키 버전). ticket_required_at을 채운다.
export async function issueEnrollTicketIn(tx: Tx, ring: MfaKeyring, userId: string, issuedBy: string | null): Promise<{ code: string; expiresAt: Date }> {
  const code = newEnrollTicketCode();
  await tx.query('delete from auth.mfa_enroll_tickets where user_id = $1', [userId]);
  const r = await tx.query<{ expires_at: Date }>(
    `insert into auth.mfa_enroll_tickets (user_id, code_hmac, key_version, issued_by, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(secs => $5::int)) returning expires_at`,
    [userId, codeHmac(ring, ring.current, 'enroll-ticket', code), ring.current, issuedBy, TICKET_TTL_SECONDS],
  );
  return { code, expiresAt: r.rows[0].expires_at };
}

// 2.7.2 서버 동작: 등록·대기·복구 코드·대기표 삭제, 모든 세션 삭제, 새 등록 코드, ticket_required_at·reset_at = now().
export async function resetTargetIn(tx: Tx, ring: MfaKeyring, targetId: string, issuedBy: string | null): Promise<{ code: string; expiresAt: Date }> {
  await lockUserMfaIn(tx, targetId);
  await clearUserMfaIn(tx, targetId);
  const t = await issueEnrollTicketIn(tx, ring, targetId, issuedBy);
  await touchStateIn(tx, targetId, 'ticket_required_at = now(), reset_at = now()');
  await revokeAllSessionsIn(tx, targetId);
  return t;
}

export type AdminResetInput = { requesterId: string; targetId: string; code: string; reason: (typeof ADMIN_RESET_REASONS)[number]; ip: string | null; ipKey: string | null };

export async function adminResetMfa(deps: MfaDeps, input: AdminResetInput): Promise<{ ok: true; enrollTicket: string; ticketExpiresAt: Date } | Fail> {
  const ring = ringOf(deps);
  if (input.requesterId === input.targetId) return fail('conflict', 'self_reset');
  return runWithMails(deps, async (tx, mails) => {
    // 초기화끼리는 직렬화한다(두 관리자가 서로를 동시에 초기화할 때 행 잠금 순서가 엇갈리지 않게)
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', ['bara_edu.mfa_admin_reset']);
    const target = await accountIn(tx, input.targetId);
    if (!target) return fail('not_found', 'not_found');
    if (target.status === 'withdrawn') return fail('conflict', 'target_withdrawn');
    if (target.role !== 'admin') return fail('conflict', 'target_not_admin');

    await lockFailsIn(tx, input.requesterId);
    const locked = await lockStateIn(tx, input.requesterId);
    if (locked) return lockedFail(locked);
    const r = await checkFactorCodeIn(tx, ring, input.requesterId, input.code);
    if (r === 'no_factor') return fail('forbidden', 'mfa_session_required');
    if (r === 'reused') {
      logFail(deps, input.requesterId, 'reused', input.ipKey);
      return fail('forbidden', 'code_reused');
    }
    if (r === 'wrong') {
      logFail(deps, input.requesterId, 'wrong_code', input.ipKey);
      const l = await recordFailIn(tx, deps, input.requesterId, mails);
      return l ? lockedFail(l) : fail('forbidden', 'wrong_code');
    }
    await releaseRecentFailsIn(tx, input.requesterId);

    const t = await resetTargetIn(tx, ring, input.targetId, input.requesterId);
    const at = kstStamp(new Date());
    const plan = await planAlertsIn(tx, input.targetId, deps.alertTo, { own: { template: 'mfa_reset', at, by: 'admin' }, alert: 'reset', at });
    // 메모는 기록에 넣지 않는다(사유 키만, 2.7.2)
    await logIn(tx, input.requesterId, input.targetId, MFA_ACTIONS.reset, `reason=${input.reason};by=admin${selfOnlySuffix(plan)}`, input.ip);
    mails.push(...plan.messages);
    return { ok: true as const, enrollTicket: t.code, ticketExpiresAt: t.expiresAt };
  });
}

export type AdminMfaState = 'enrolled' | 'not_enrolled' | 'reset_pending';

const ADMIN_STATE_SQL = `
  select u.id, p.role::text as role, p.status::text as status, f.confirmed_at, f.last_used_at,
         case when t.used_at is null and t.expires_at > now() and t.fail_count < ${TICKET_MAX_FAILS} then t.expires_at end as ticket_until
    from auth.users u
    join public.profiles p on p.id = u.id
    left join auth.mfa_factors f on f.user_id = u.id
    left join auth.mfa_enroll_tickets t on t.user_id = u.id`;

type StateRow = { id: string; role: string; status: string; confirmed_at: Date | null; last_used_at: Date | null; ticket_until: Date | null };
const stateOf = (r: StateRow): AdminMfaState => (r.confirmed_at ? 'enrolled' : r.ticket_until ? 'reset_pending' : 'not_enrolled');

export async function adminGetMfa(pool: pg.Pool, targetId: string): Promise<{ state: AdminMfaState; enrolledAt: string | null; lastUsedAt: string | null; ticketPendingUntil: string | null } | Fail> {
  return withService(pool, async (tx) => {
    const r = await tx.query<StateRow>(`${ADMIN_STATE_SQL} where u.id = $1`, [targetId]);
    const row = r.rows[0];
    if (!row || row.role !== 'admin') return fail('not_found', 'not_found');
    const state = stateOf(row);
    return {
      state,
      enrolledAt: row.confirmed_at?.toISOString() ?? null,
      lastUsedAt: row.last_used_at?.toISOString() ?? null,
      ticketPendingUntil: state === 'reset_pending' ? row.ticket_until!.toISOString() : null,
    };
  });
}

export async function adminMfaOverview(pool: pg.Pool): Promise<{ items: Array<{ userId: string; state: AdminMfaState }> }> {
  return withService(pool, async (tx) => {
    const r = await tx.query<StateRow>(`${ADMIN_STATE_SQL} where p.role = 'admin' and p.status = 'active' order by u.id`);
    return { items: r.rows.map((row) => ({ userId: row.id, state: stateOf(row) })) };
  });
}

export type { AlertPlan };
