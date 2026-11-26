import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { withService, type Tx } from '../db/context.js';
import type { MfaMode } from '../config.js';

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

export type MfaMethod = 'totp' | 'recovery' | 'enroll';
export type SessionEndReason = 'max' | 'idle' | 'mfa_required';

// 관리자 세션: 최대 12시간(연장 없음) + 1시간 미사용 만료(대표 결정 Q2, 기획서 2.3). 숫자는 SQL 안에도 같은 값으로 쓴다.
export const ADMIN_SESSION_MAX_HOURS = 12;
export const ADMIN_IDLE_MINUTES = 60;

// 관리자(role='admin')면 만료를 발급 + 12시간으로 둔다(어느 경로로 만들든: 로그인, 2단계, 가입 마무리). mfaMethod가 있으면 mfa_at = now().
export async function createSessionIn(tx: Tx, userId: string, ttlDays: number, opts: { mfaMethod?: MfaMethod } = {}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const r = await tx.query<{ expires_at: Date }>(
    `insert into auth.sessions (token_hash, user_id, expires_at, mfa_at, mfa_method)
     select $1, $2,
            case when exists (select 1 from public.profiles where id = $2 and role = 'admin')
                 then now() + interval '12 hours' else now() + make_interval(days => $3::int) end,
            case when $4::text is null then null else now() end, $4::text
     returning expires_at`,
    [sha256(token), userId, ttlDays, opts.mfaMethod ?? null],
  );
  return { token, expiresAt: r.rows[0].expires_at };
}

export function createSession(pool: pg.Pool, userId: string, ttlDays: number, opts: { mfaMethod?: MfaMethod } = {}): Promise<{ token: string; expiresAt: Date }> {
  return withService(pool, (tx) => createSessionIn(tx, userId, ttlDays, opts));
}

export type SessionInspection =
  | { kind: 'ok'; userId: string; expiresAt: Date; renewed: boolean; isAdmin: boolean; mfaAt: Date | null; mfaMethod: MfaMethod | null }
  | { kind: 'ended'; reason: SessionEndReason };

type Row = {
  user_id: string;
  expires_at: Date;
  admin_expires: Date;
  mfa_at: Date | null;
  mfa_method: MfaMethod | null;
  role: string | null;
  enrolled: boolean;
  ticket_required: boolean;
  over_max: boolean;
  over_idle: boolean;
  stale_seen: boolean;
};

// 관리자 세션 규칙(기획서 2.3, 보안 점검 I-2): 모든 모드에서 매 요청 12시간(max)·1시간(idle)을 판정하고(둘 다면 max), 그 다음 mfa_at 규칙을 모드별로 본다.
// 죽은 세션은 행을 지우고 이유를 돌려준다. 관리자 세션은 슬라이딩 연장하지 않는다. activity면 판정 뒤 last_seen_at을 1분에 한 번만 갱신한다.
export async function inspectSession(
  pool: pg.Pool,
  token: string,
  ttlDays: number,
  opts: { mode: MfaMode; activity: boolean },
): Promise<SessionInspection | null> {
  return withService(pool, async (tx) => {
    const r = await tx.query<Row>(
      `select s.user_id, s.expires_at, least(s.expires_at, s.created_at + interval '12 hours') as admin_expires,
              s.mfa_at, s.mfa_method, p.role::text as role,
              exists (select 1 from auth.mfa_factors f where f.user_id = s.user_id) as enrolled,
              coalesce(st.ticket_required_at is not null, false) as ticket_required,
              now() >= s.created_at + interval '12 hours' as over_max,
              now() >= s.last_seen_at + interval '1 hour' as over_idle,
              s.last_seen_at < now() - interval '1 minute' as stale_seen
         from auth.sessions s
         left join public.profiles p on p.id = s.user_id
         left join auth.mfa_account_state st on st.user_id = s.user_id
        where s.token_hash = $1 and s.expires_at > now()`,
      [sha256(token)],
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    if (row.role === 'admin') {
      let reason: SessionEndReason | null = null;
      if (row.over_max) reason = 'max';
      else if (row.over_idle) reason = 'idle';
      else if (row.mfa_at === null) {
        const passwordOnlyAllowed = opts.mode === 'off' || (opts.mode === 'optional' && !row.enrolled && !row.ticket_required);
        if (!passwordOnlyAllowed) reason = 'mfa_required';
      }
      if (reason !== null) {
        await tx.query('delete from auth.sessions where token_hash = $1', [sha256(token)]);
        return { kind: 'ended', reason };
      }
      if (opts.activity && row.stale_seen) await tx.query('update auth.sessions set last_seen_at = now() where token_hash = $1', [sha256(token)]);
      return { kind: 'ok', userId: row.user_id, expiresAt: row.admin_expires, renewed: false, isAdmin: true, mfaAt: row.mfa_at, mfaMethod: row.mfa_method };
    }
    const halfMs = (ttlDays * 86_400_000) / 2;
    if (row.expires_at.getTime() - Date.now() < halfMs) {
      const u = await tx.query<{ expires_at: Date }>(
        'update auth.sessions set expires_at = now() + make_interval(days => $2::int) where token_hash = $1 returning expires_at',
        [sha256(token), ttlDays],
      );
      if (u.rowCount === 0) return null;
      return { kind: 'ok', userId: row.user_id, expiresAt: u.rows[0].expires_at, renewed: true, isAdmin: false, mfaAt: row.mfa_at, mfaMethod: row.mfa_method };
    }
    return { kind: 'ok', userId: row.user_id, expiresAt: row.expires_at, renewed: false, isAdmin: false, mfaAt: row.mfa_at, mfaMethod: row.mfa_method };
  });
}

// 기존 호출부용: 살아 있는 세션만 돌려준다(모드 기본값 enforce, "사용" 갱신 없음).
export async function resolveSession(
  pool: pg.Pool,
  token: string,
  ttlDays: number,
  opts: { mode: MfaMode; activity: boolean } = { mode: 'enforce', activity: false },
): Promise<{ userId: string; expiresAt: Date; renewed: boolean } | null> {
  const s = await inspectSession(pool, token, ttlDays, opts);
  return s && s.kind === 'ok' ? { userId: s.userId, expiresAt: s.expiresAt, renewed: s.renewed } : null;
}

// /v1/query 쓰기처럼 본문을 봐야 "사용"인지 아는 요청에서 부른다(guard는 본문을 보기 전에 돈다). 관리자 세션만, 1분에 한 번.
export async function touchAdminSession(pool: pg.Pool, token: string): Promise<void> {
  await withService(pool, (tx) =>
    tx.query(
      `update auth.sessions s set last_seen_at = now()
        where s.token_hash = $1 and s.last_seen_at < now() - interval '1 minute'
          and exists (select 1 from public.profiles p where p.id = s.user_id and p.role = 'admin')`,
      [sha256(token)],
    ),
  );
}

export async function revokeSession(pool: pg.Pool, token: string): Promise<void> {
  await withService(pool, (tx) => tx.query('delete from auth.sessions where token_hash = $1', [sha256(token)]));
}

export async function revokeAllSessions(pool: pg.Pool, userId: string): Promise<void> {
  await withService(pool, (tx) => tx.query('delete from auth.sessions where user_id = $1', [userId]));
}

export async function revokeOtherSessionsIn(tx: Tx, userId: string, keepToken: string): Promise<void> {
  await tx.query('delete from auth.sessions where user_id = $1 and token_hash <> $2', [userId, sha256(keepToken)]);
}

export async function revokeAllSessionsIn(tx: Tx, userId: string): Promise<void> {
  await tx.query('delete from auth.sessions where user_id = $1', [userId]);
}
