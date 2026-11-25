import { afterAll, beforeAll, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb } from './helpers/db.js';

const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');
const PATCH = path.join(dbDir, 'patches', '2026-11-25-r24.sql');
const FUNCTIONS = ['get_quiz_for_lesson', 'submit_quiz_attempt'];
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

test('패치는 create or replace function만 담는다 (테이블·정책·트리거·데이터 변경 없음)', () => {
  const noComments = patch.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const skeleton = noComments.replace(/\$\$[\s\S]*?\$\$/g, '$$$$');
  const statements = skeleton.split(';').map((s) => s.trim()).filter(Boolean);
  expect(statements).toHaveLength(FUNCTIONS.length);
  for (const st of statements) expect(st).toMatch(/^create or replace function public\.(get_quiz_for_lesson|submit_quiz_attempt)\(/);
  expect(skeleton).not.toMatch(/\b(drop|alter|truncate|grant|revoke)\b/i);
});

test('패치의 함수 정의는 02-schema.sql과 글자 그대로 같다 (둘이 어긋나지 않게)', () => {
  for (const f of FUNCTIONS) {
    expect(block(patch, f), f).toBe(block(schema, f));
  }
});

test('테스트 DB에 적용: 여러 번 실행해도 성공하고, 함수의 권한(proacl)·소유자는 바뀌지 않는다', async () => {
  const snapshot = async () =>
    (await ctx.adminPool.query("select proname, proacl::text as acl, proowner::regrole::text as owner, md5(prosrc) as src from pg_proc where proname = any($1) order by proname", [FUNCTIONS])).rows;
  const before = await snapshot();
  expect(before).toHaveLength(2);
  for (let i = 0; i < 2; i++) {
    const c = await ctx.adminPool.connect();
    try {
      await c.query('begin'); // --single-transaction과 같다
      await c.query(patch);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  const after = await snapshot();
  expect(after).toEqual(before);
});
