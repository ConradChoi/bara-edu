import { afterAll, beforeAll, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb } from './helpers/db.js';

// 2026-11-27 패치: diagnosis_leads 관리자 select 정책 제거(QA minor 2).
const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');
const PATCH = path.join(dbDir, 'patches', '2026-11-27-diagnosis-leads-admin-select.sql');
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let patch: string;

beforeAll(async () => {
  ctx = await setupTestDb();
  patch = await readFile(PATCH, 'utf8');
});
afterAll(async () => {
  await ctx.close();
});
const q = async (sql: string, params: unknown[] = []) => (await ctx.adminPool.query(sql, params)).rows;
const policies = () => q("select policyname from pg_policies where tablename = 'diagnosis_leads'");

test('패치는 lock_timeout + drop policy 1개만 담고 역할 전환·grant·데이터 변경이 없다', () => {
  const stmts = patch.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
  expect(stmts).toEqual(["set local lock_timeout = '5s'", 'drop policy if exists "diagnosis_leads_admin_select" on diagnosis_leads']);
});

test('옛 정책이 있는 DB에 적용하면 정책이 사라지고, 두 번 적용해도 오류 없다(멱등). 관리자도 직접 조회 0행', async () => {
  await q('create policy "diagnosis_leads_admin_select" on diagnosis_leads for select using (is_admin())');
  expect(await policies()).toHaveLength(1);
  for (let i = 0; i < 2; i++) await q(`begin; set local role bara_edu_service; ${patch}; commit`);
  expect(await policies()).toEqual([]);

  const admin = (await q("insert into auth.users (email, email_confirmed_at) values ('pa@example.com', now()) returning id"))[0].id as string;
  await q(`begin; set local session_replication_role = replica; update profiles set role='admin' where id='${admin}'; commit`);
  await q("insert into diagnosis_leads (name, contact, consent_contact) values ('문의자', '010-1111-2222', true)");
  const c = await ctx.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role bara_edu_authenticated');
    await c.query(`select set_config('request.user_id', $1, true)`, [admin]);
    expect((await c.query('select id from diagnosis_leads')).rowCount).toBe(0);
    await c.query('rollback');
  } finally {
    c.release();
  }
});
