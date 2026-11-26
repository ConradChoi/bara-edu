import { afterAll, beforeAll, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb } from './helpers/db.js';

// 2026-11-26 패치: 관리자 접속 기록 보관 기간 1년 -> 2년(대표 결정).
const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');
const PATCH = path.join(dbDir, 'patches', '2026-11-26-access-log-2y.sql');
const FN = 'purge_old_admin_access_logs';
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let patch: string;
let schema: string;

beforeAll(async () => {
  ctx = await setupTestDb();
  patch = await readFile(PATCH, 'utf8');
  schema = await readFile(path.join(dbDir, '02-schema.sql'), 'utf8');
});
afterAll(async () => {
  await ctx.close();
});

const block = (sql: string, name: string) => {
  const a = sql.indexOf(`create or replace function public.${name}(`);
  return sql.slice(a, sql.indexOf('\n$$;', a) + 4);
};
const q = async (sql: string, params: unknown[] = []) => (await ctx.adminPool.query(sql, params)).rows;

test('패치는 create or replace function 1개만 담고 역할 전환·grant·revoke가 없다', () => {
  const noComments = patch.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const skeleton = noComments.replace(/\$\$[\s\S]*?\$\$/g, '$$$$');
  const statements = skeleton.split(';').map((s) => s.trim()).filter(Boolean);
  expect(statements).toHaveLength(1);
  expect(statements[0]).toMatch(/^create or replace function public\.purge_old_admin_access_logs\(/);
  expect(skeleton).not.toMatch(/\b(alter|drop|truncate|grant|revoke)\b|set\s+(local\s+)?role/i);
});

test('패치의 함수 정의는 02-schema.sql과 글자 그대로 같고 2 years를 쓴다', () => {
  expect(block(patch, FN)).toBe(block(schema, FN));
  expect(block(schema, FN)).toContain("interval '2 years'");
  expect(block(schema, FN)).not.toContain("interval '1 year'");
});

test('1년 반 된 기록은 남고 2년 넘은 기록은 지워진다', async () => {
  const admin = (await q("insert into auth.users (email, email_confirmed_at) values ('al@example.com', now()) returning id"))[0].id as string;
  const mk = async (interval: string) =>
    (await q("insert into admin_access_logs (admin_id, action, created_at) values ($1, 'x', now() - $2::interval) returning id", [admin, interval]))[0].id as string;
  const young = await mk('6 months');
  const oneHalf = await mk('18 months');
  const justUnder = await mk('2 years - 1 day');
  const old = await mk('2 years 1 day');
  const older = await mk('5 years');
  const r = await q(`select public.${FN}() as n`);
  expect(Number(r[0].n)).toBe(2);
  const left = (await q('select id from admin_access_logs where admin_id = $1', [admin])).map((x) => x.id);
  expect(left.sort()).toEqual([young, oneHalf, justUnder].sort());
  expect(left).not.toContain(old);
  expect(left).not.toContain(older);
});

test('패치를 소유자 역할로 두 번 적용해도 성공하고 소유자·권한(proacl)·본문이 그대로다', async () => {
  const snap = async () => (await q('select proacl::text as acl, proowner::regrole::text as owner, md5(prosrc) as src from pg_proc where proname = $1', [FN]))[0];
  const before = await snap();
  for (let i = 0; i < 2; i++) {
    const c = await ctx.adminPool.connect();
    try {
      await c.query('begin');
      await c.query('set local role bara_edu_service');
      await c.query(patch);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  expect(await snap()).toEqual(before);
  const x = await q("select has_function_privilege('bara_edu_anon', 'public.purge_old_admin_access_logs()', 'execute') a, has_function_privilege('bara_edu_authenticated', 'public.purge_old_admin_access_logs()', 'execute') b");
  expect(x[0]).toEqual({ a: false, b: false });
});
