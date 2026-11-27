import { afterAll, beforeAll, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb } from './helpers/db.js';

// 2026-11-27 패치: 입구 C 대기에는 session_hash가 반드시 있게(보안 점검 R-3).
const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');
const PATCH = path.join(dbDir, 'patches', '2026-11-27-mfa-enroll-c-session-required.sql');
const block = (t: string) => t.slice(t.indexOf('-- R-3 시작'), t.indexOf('-- R-3 끝'));
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
const q = async (sql: string, p: unknown[] = []) => (await ctx.adminPool.query(sql, p)).rows;
const hasCheck = async () => (await q("select count(*)::int n from pg_constraint where conrelid = 'auth.mfa_enrollments'::regclass and conname = 'mfa_enrollments_entry_c_session_check'"))[0].n;

test('제약 블록은 01-auth.sql과 글자 그대로 같고, 패치 앞부분은 lock_timeout + null C 대기 삭제뿐', () => {
  expect(block(patch).length).toBeGreaterThan(50);
  expect(block(auth)).toBe(block(patch));
  const head = patch.slice(0, patch.indexOf('-- R-3 시작')).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
  expect(head).toEqual(["set local lock_timeout = '5s'", "delete from auth.mfa_enrollments where entry = 'C' and session_hash is null"]);
});

test('제약이 없고 null C 대기가 있는 DB(지금 운영)에 적용하면 그 대기만 지우고 제약이 생긴다. 두 번 적용해도 오류 없다', async () => {
  await q('alter table auth.mfa_enrollments drop constraint mfa_enrollments_entry_c_session_check');
  expect(await hasCheck()).toBe(0);
  const users = await q("insert into auth.users (email) values ('r3-c@example.com'), ('r3-a@example.com') returning id");
  const ins = "insert into auth.mfa_enrollments (user_id, entry, replace_check, secret_ciphertext, secret_iv, key_version, expires_at) values ($1, $2, $3, '\\x00', '\\x00', 1, now() + interval '10 minutes')";
  await q(ins, [users[0].id, 'C', 'totp']);
  await q(ins, [users[1].id, 'A', null]);
  for (let i = 0; i < 2; i++) await q(`begin; set local role bara_edu_service; ${patch}; commit`);
  expect(await hasCheck()).toBe(1);
  const left = await q('select entry from auth.mfa_enrollments where user_id = any($1) order by entry', [[users[0].id, users[1].id]]);
  expect(left).toEqual([{ entry: 'A' }]);
  await expect(q(ins, [users[0].id, 'C', 'totp'])).rejects.toThrow(/mfa_enrollments_entry_c_session_check/);
});
