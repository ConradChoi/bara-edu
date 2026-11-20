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

test('정책 수 = 원본 정책 수 - storage 정책 4개', async () => {
  // categories_public_select / legal_documents_public_select are created twice (drop + recreate), so count distinct table+name.
  const defs = [...original.matchAll(/^\s*create policy ("[^"]+") on (\S+)/gim)].map((m) => `${m[2]} ${m[1]}`);
  const storageCount = defs.filter((d) => d.startsWith('storage.objects ')).length;
  expect(storageCount).toBe(4);
  const originalCount = new Set(defs).size;
  const { rows } = await adminPool.query("select count(*)::int n from pg_policies where schemaname='public'");
  expect(rows[0].n).toBe(originalCount - storageCount);
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
