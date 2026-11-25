import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type pg from 'pg';
import { applyDb } from '../src/db/apply.js';
import { setupTestDb, TEST_APP_PASSWORD } from './helpers/db.js';

const ported = readFileSync('db/02-schema.sql', 'utf8');
const original = readFileSync('../supabase/schema.sql', 'utf8');

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let adminPool: pg.Pool;

beforeAll(async () => {
  ctx = await setupTestDb();
  adminPool = ctx.adminPool;
});
afterAll(async () => {
  await ctx.close();
});

test('포팅본에 storage·cron·supabase 역할 이름이 없다', () => {
  const code = ported.replace(/^--.*$/gm, '');
  expect(code).not.toMatch(/\bstorage\./);
  expect(code).not.toMatch(/\bcron\.|pg_cron/);
  expect(code).not.toMatch(/\b(from|to)\s+(public,\s*)?(anon|authenticated|service_role)\b/);
});

test('정책 수 = 원본 정책 수 - storage 정책 4개 - 의도적으로 없앤 정책', async () => {
  // categories_public_select / legal_documents_public_select are created twice (drop + recreate), so count distinct table+name.
  const defs = [...original.matchAll(/^\s*create policy ("[^"]+") on (\S+)/gim)].map((m) => `${m[2]} ${m[1]}`);
  const storageCount = defs.filter((d) => d.startsWith('storage.objects ')).length;
  expect(storageCount).toBe(4);
  const originalCount = new Set(defs).size;
  const { rows } = await adminPool.query("select count(*)::int n from pg_policies where schemaname='public'");
  // 원본(supabase/schema.sql)에는 있지만 이 스키마에서 의도적으로 없앤 정책: 리드 update(2026-11-26, 변경은 접속 기록과 함께 API op로만)
  const removedOnPurpose = 1;
  expect(rows[0].n).toBe(originalCount - storageCount - removedOnPurpose);
});

test('public 테이블의 소유자는 모두 bara_edu_service', async () => {
  const { rows } = await adminPool.query("select tablename, tableowner from pg_tables where schemaname='public'");
  expect(rows.length).toBeGreaterThan(20);
  expect(rows.filter((r) => r.tableowner !== 'bara_edu_service')).toEqual([]);
  const rls = await adminPool.query(
    "select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity",
  );
  expect(rls.rows).toEqual([]);
});

test('purge 함수는 authenticated가 실행할 수 없다', async () => {
  const c = await adminPool.connect();
  try {
    await c.query('begin');
    await c.query('set local role bara_edu_authenticated');
    await expect(c.query('select public.purge_unverified_signups()')).rejects.toMatchObject({ code: '42501' });
    await c.query('rollback');
    await c.query('begin');
    await c.query('set local role bara_edu_anon');
    await expect(c.query('select public.purge_old_admin_access_logs()')).rejects.toMatchObject({ code: '42501' });
  } finally {
    await c.query('rollback');
    c.release();
  }
});

test('auth.users insert 시 profiles 행이 생긴다(handle_new_user)', async () => {
  const { rows } = await adminPool.query(
    `insert into auth.users (email, raw_user_meta_data) values ('hong@example.com', '{"name":"홍길동","phone":"010"}') returning id`,
  );
  const p = await adminPool.query('select name, phone, role, status, email from public.profiles where id=$1', [rows[0].id]);
  expect(p.rows).toEqual([
    { name: '홍길동', phone: '010', role: 'learner', status: 'active', email: 'hong@example.com' },
  ]);
});

test('스키마를 두 번 적용해도 성공', async () => {
  const { rows } = await adminPool.query('select current_database() d');
  const u = new URL(adminPool.options.connectionString as string);
  u.pathname = `/${rows[0].d}`;
  await expect(applyDb(u.toString(), { appPassword: TEST_APP_PASSWORD })).resolves.toBeUndefined();
});

const REVOKED: Array<[string, string[]]> = [
  ['public.purge_unverified_signups()', ['public', 'bara_edu_anon', 'bara_edu_authenticated']],
  ['public.purge_old_admin_access_logs()', ['public', 'bara_edu_anon', 'bara_edu_authenticated']],
  ['public.claim_diagnosis(uuid)', ['public', 'bara_edu_anon']],
  ['public.get_diagnosis_detail(uuid)', ['public', 'bara_edu_anon']],
  ['public.purge_unclaimed_diagnosis_pii()', ['public', 'bara_edu_anon', 'bara_edu_authenticated']],
  ['public.purge_old_diagnosis_leads()', ['public', 'bara_edu_anon', 'bara_edu_authenticated']],
  ['public.get_my_diagnosis_results()', ['public', 'bara_edu_anon']],
];

test.each(REVOKED)('%s 실행 권한이 회수된 역할에는 없다', async (fn, roles) => {
  for (const role of roles) {
    const { rows } = await adminPool.query('select has_function_privilege($1, $2, $3) ok', [role, fn, 'execute']);
    expect({ role, ok: rows[0].ok }).toEqual({ role, ok: false });
  }
});

test('회수 대상이 아닌 역할은 실행 권한을 유지한다', async () => {
  const q = (role: string, fn: string) =>
    adminPool.query('select has_function_privilege($1, $2, $3) ok', [role, fn, 'execute']).then((r) => r.rows[0].ok);
  expect(await q('bara_edu_authenticated', 'public.claim_diagnosis(uuid)')).toBe(true);
  expect(await q('bara_edu_authenticated', 'public.get_diagnosis_detail(uuid)')).toBe(true);
  expect(await q('bara_edu_authenticated', 'public.get_my_diagnosis_results()')).toBe(true);
  expect(await q('bara_edu_anon', 'public.get_diagnosis_summary(uuid)')).toBe(true);
  expect(await q('bara_edu_service', 'public.purge_unverified_signups()')).toBe(true);
});

test('PUBLIC은 public·auth 스키마의 어떤 함수도 실행할 수 없다(security definer 포함)', async () => {
  const { rows } = await adminPool.query(
    `select p.oid::regprocedure::text fn, p.prosecdef
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'auth') and has_function_privilege('public', p.oid, 'execute')`,
  );
  expect(rows).toEqual([]);
  const sd = await adminPool.query(
    "select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef",
  );
  expect(sd.rows[0].n).toBeGreaterThan(10);
});

test('PUBLIC은 데이터베이스 접속·public 스키마 사용 권한이 없고 bara_edu_app만 접속할 수 있다', async () => {
  const { rows } = await adminPool.query(
    `select has_database_privilege('public', current_database(), 'connect') pub_connect,
            has_database_privilege('bara_edu_app', current_database(), 'connect') app_connect,
            has_schema_privilege('public', 'public', 'usage') pub_usage,
            has_schema_privilege('bara_edu_anon', 'public', 'usage') anon_usage,
            has_schema_privilege('bara_edu_authenticated', 'public', 'usage') auth_usage,
            has_schema_privilege('bara_edu_service', 'public', 'usage') svc_usage`,
  );
  expect(rows[0]).toEqual({ pub_connect: false, app_connect: true, pub_usage: false, anon_usage: true, auth_usage: true, svc_usage: true });
});

test('bara_edu_service가 새로 만드는 함수도 PUBLIC 실행 권한이 없다', async () => {
  const c = await adminPool.connect();
  try {
    await c.query('begin');
    await c.query('set local role bara_edu_service');
    await c.query('create function public.priv_probe() returns int language sql as $$ select 1 $$');
    const { rows } = await c.query("select has_function_privilege('public', 'public.priv_probe()', 'execute') ok");
    expect(rows[0].ok).toBe(false);
  } finally {
    await c.query('rollback');
    c.release();
  }
});
