import { afterAll, beforeAll, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb } from './helpers/db.js';

// 2026-11-27 패치: 입구 C 등록 대기를 시작한 세션에 묶는 auth.mfa_enrollments.session_hash(보안 점검 m-1).
const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');
const PATCH = path.join(dbDir, 'patches', '2026-11-27-mfa-enroll-session.sql');
const ALTER = 'alter table auth.mfa_enrollments add column if not exists session_hash text references auth.sessions (token_hash) on delete cascade';
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let patch: string;
let auth: string;

beforeAll(async () => {
  ctx = await setupTestDb();
  patch = await readFile(PATCH, 'utf8');
  auth = await readFile(path.join(dbDir, '01-auth.sql'), 'utf8');
});
afterAll(async () => {
  await ctx.close();
});
const q = async (sql: string) => (await ctx.adminPool.query(sql)).rows;

test('패치는 lock_timeout + 컬럼 추가 1개뿐이고 01-auth.sql의 줄과 같다', () => {
  const stmts = patch.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
  expect(stmts).toEqual(["set local lock_timeout = '5s'", ALTER]);
  expect(auth).toContain(`${ALTER};`);
});

test('컬럼이 없는 DB에 적용하면 생기고, 두 번 적용해도 오류 없다. 세션 삭제 시 대기도 삭제(on delete cascade)', async () => {
  await q('alter table auth.mfa_enrollments drop column session_hash');
  for (let i = 0; i < 2; i++) await q(`begin; set local role bara_edu_service; ${patch}; commit`);
  const col = await q("select data_type, is_nullable from information_schema.columns where table_schema = 'auth' and table_name = 'mfa_enrollments' and column_name = 'session_hash'");
  expect(col).toEqual([{ data_type: 'text', is_nullable: 'YES' }]);
  const fk = await q("select confdeltype from pg_constraint where conrelid = 'auth.mfa_enrollments'::regclass and contype = 'f' and conkey = (select array_agg(attnum) from pg_attribute where attrelid = 'auth.mfa_enrollments'::regclass and attname = 'session_hash')");
  expect(fk).toEqual([{ confdeltype: 'c' }]);
});
