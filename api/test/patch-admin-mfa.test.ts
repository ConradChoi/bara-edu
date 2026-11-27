import { afterAll, beforeAll, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb } from './helpers/db.js';
import { JOBS } from '../src/jobs/scheduler.js';

// 2026-11-26 패치: 관리자 2단계 인증 스키마(기획서 2.11) + 정리 함수.
const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');
const PATCH = path.join(dbDir, 'patches', '2026-11-26-admin-mfa.sql');
const START = '-- ===== 관리자 2단계 인증(인증 앱 OTP) 시작 (2026-11-26) =====';
const END = '-- ===== 관리자 2단계 인증 끝 =====';
const FN = 'purge_expired_mfa_rows';
const TABLES = ['mfa_challenges', 'mfa_factors', 'mfa_enrollments', 'mfa_recovery_codes', 'mfa_enroll_tickets', 'mfa_account_state', 'mfa_key_check', 'mfa_runtime'];
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let patch: string;
let auth: string;
let schema: string;

beforeAll(async () => {
  ctx = await setupTestDb();
  patch = await readFile(PATCH, 'utf8');
  auth = await readFile(path.join(dbDir, '01-auth.sql'), 'utf8');
  schema = await readFile(path.join(dbDir, '02-schema.sql'), 'utf8');
});
afterAll(async () => {
  await ctx.close();
});

const between = (sql: string, a: string, b: string) => {
  const i = sql.indexOf(a);
  expect(i).toBeGreaterThanOrEqual(0);
  return sql.slice(i, sql.indexOf(b, i) + b.length);
};
const fnBlock = (sql: string) => between(sql, `create or replace function public.${FN}(`, '\n$$;');
const REVOKE = `revoke execute on function public.${FN}() from public, bara_edu_anon, bara_edu_authenticated;`;
const q = async (sql: string, params: unknown[] = []) => (await ctx.adminPool.query(sql, params)).rows;

async function applyPatch() {
  const c = await ctx.adminPool.connect();
  try {
    await c.query('begin');
    await c.query('set local role bara_edu_service');
    await c.query(patch);
    // 그 뒤 후속 패치(2026-11-27 입구 C 세션 묶기, R-3 검사 제약)까지 적용해야 현행 01-auth.sql과 같은 모양이 된다.
    await c.query(await readFile(path.join(dbDir, 'patches', '2026-11-27-mfa-enroll-session.sql'), 'utf8'));
    await c.query(await readFile(path.join(dbDir, 'patches', '2026-11-27-mfa-enroll-c-session-required.sql'), 'utf8'));
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

// 스키마 모양(컬럼·제약·인덱스·소유자·권한) 스냅숏
async function snapshot() {
  return {
    cols: await q(
      `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'auth' and (table_name = any($1) or (table_name = 'sessions' and column_name in ('mfa_at', 'mfa_method', 'last_seen_at')))
        order by 1, 2`,
      [TABLES],
    ),
    cons: await q(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where connamespace = 'auth'::regnamespace and (conrelid::regclass::text like 'auth.mfa_%' or conname = 'sessions_mfa_method_check') order by 1, 2`),
    idx: await q(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'auth' and (tablename like 'mfa_%' or indexname = 'sessions_user_idx') order by 1, 2`),
    owners: await q(`select relname, relowner::regrole::text o, relacl::text acl from pg_class where relnamespace = 'auth'::regnamespace and relname = any($1) order by 1`, [TABLES]),
    fn: await q('select proacl::text acl, proowner::regrole::text owner, prosecdef, md5(prosrc) src from pg_proc where proname = $1', [FN]),
  };
}

test('패치 블록은 01-auth.sql·02-schema.sql과 글자 그대로 같다', () => {
  expect(between(patch, START, END)).toBe(between(auth, START, END));
  expect(fnBlock(patch)).toBe(fnBlock(schema));
  expect(patch).toContain(REVOKE);
  expect(schema).toContain(REVOKE);
  expect(patch.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')).not.toMatch(/set\s+(local\s+)?role|\bgrant\b|\bdrop\b|\btruncate\b/i);
});

test('패치 이전 DB(새 객체 없음)에 소유자 역할로 적용하면 01·02로 만든 것과 같은 모양이 되고, 두 번째 적용도 성공한다', async () => {
  const want = await snapshot();
  expect(want.owners.map((r) => r.o)).toEqual(TABLES.map(() => 'bara_edu_service'));
  expect(want.owners.every((r) => r.acl === null || !/bara_edu_(anon|authenticated|app)=/.test(r.acl))).toBe(true);
  // 운영 DB의 패치 전 상태로 되돌린다
  await q(`drop function public.${FN}()`);
  await q(`drop table ${TABLES.map((t) => `auth.${t}`).join(', ')} cascade`);
  await q('drop index if exists auth.sessions_user_idx');
  await q('alter table auth.sessions drop constraint sessions_mfa_method_check, drop column mfa_at, drop column mfa_method, drop column last_seen_at');
  await q("insert into auth.users (email, email_confirmed_at) values ('patch-old@example.com', now())");
  await q("insert into auth.sessions (token_hash, user_id, expires_at) select 'old-session', id, now() + interval '30 days' from auth.users where email = 'patch-old@example.com'");
  await applyPatch();
  expect(await snapshot()).toEqual(want);
  await applyPatch();
  expect(await snapshot()).toEqual(want);
  // 기존 세션 행은 그대로, 새 컬럼은 null / now()
  const [s] = await q("select mfa_at, mfa_method, last_seen_at is not null as seen from auth.sessions where token_hash = 'old-session'");
  expect(s).toEqual({ mfa_at: null, mfa_method: null, seen: true });
});

test('앱·익명·로그인 역할은 auth MFA 테이블을 읽을 수 없고 정리 함수도 실행할 수 없다', async () => {
  for (const role of ['bara_edu_anon', 'bara_edu_authenticated']) {
    for (const t of TABLES) {
      expect((await q(`select has_table_privilege($1, 'auth.${t}', 'select') ok`, [role]))[0].ok, `${role} ${t}`).toBe(false);
    }
    expect((await q(`select has_function_privilege($1, 'public.${FN}()', 'execute') ok`, [role]))[0].ok).toBe(false);
  }
});

test('정리 함수: 만료된 등록 대기, 만료 1일 지난 대기표, 만료·사용 1일 지난 등록 코드만 지운다', async () => {
  const uid = async (e: string) => (await q("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [e]))[0].id as string;
  const [u1, u2, u3, u4, u5, u6] = await Promise.all(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((x) => uid(`${x}-purge@example.com`)));
  const enr = (u: string, exp: string) =>
    q(`insert into auth.mfa_enrollments (user_id, entry, secret_ciphertext, secret_iv, key_version, expires_at) values ($1, 'A', '\\x00', '\\x00', 1, now() + $2::interval)`, [u, exp]);
  await enr(u1, '-1 second');
  await enr(u2, '5 minutes');
  const ch = (h: string, u: string, exp: string) => q(`insert into auth.mfa_challenges (token_hash, user_id, purpose, expires_at) values ($1, $2, 'verify', now() + $3::interval)`, [h, u, exp]);
  await ch('c-old', u1, '-25 hours');
  await ch('c-recent', u1, '-1 hour');
  await ch('c-live', u2, '5 minutes');
  const tk = (u: string, exp: string, used: string | null) =>
    q(`insert into auth.mfa_enroll_tickets (user_id, code_hmac, key_version, expires_at, used_at) values ($1, '\\x00', 1, now() + $2::interval, case when $3::text is null then null else now() + $3::interval end)`, [u, exp, used]);
  await tk(u3, '-25 hours', null);
  await tk(u4, '-1 hour', null);
  await tk(u5, '20 hours', '-25 hours');
  await tk(u6, '20 hours', '-1 hour');
  expect((await q(`select public.${FN}() n`))[0].n).toBe(4);
  expect((await q('select user_id from auth.mfa_enrollments where user_id = any($1)', [[u1, u2]])).map((r) => r.user_id)).toEqual([u2]);
  expect((await q("select token_hash from auth.mfa_challenges where token_hash like 'c-%' order by 1")).map((r) => r.token_hash)).toEqual(['c-live', 'c-recent']);
  expect((await q('select user_id from auth.mfa_enroll_tickets where user_id = any($1)', [[u3, u4, u5, u6]])).map((r) => r.user_id).sort()).toEqual([u4, u6].sort());
  expect((await q(`select public.${FN}() n`))[0].n).toBe(0);
});

test('정리 작업은 매일 03:50(KST)에 scheduler가 실행한다', () => {
  expect(JOBS).toContainEqual({ name: FN, minuteOfDay: 3 * 60 + 50 });
});
