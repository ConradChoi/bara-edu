import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const M = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CAT = '11111111-1111-4111-8111-111111111111';
const C1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';
const LESSON = '44444444-4444-4444-8444-444444444444';
const Q1 = '55555555-5555-4555-8555-555555555555';
const Q2 = '66666666-6666-4666-8666-666666666666';

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  ctx = await setupTestDb();
  const db = ctx.adminPool;
  for (const [id, name, email] of [
    [A, '홍길동', 'hong@example.com'],
    [B, '김철수', "o'brien,(x)@example.com"],
    [M, '관리자', 'admin@example.com'],
  ]) {
    await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, JSON.stringify({ name })]);
    tokens[id] = (await createSession(ctx.pool, id, 30)).token;
  }
  await db.query(`begin; set local session_replication_role = replica; update profiles set role='admin' where id='${M}'; commit`);
  await db.query(`insert into categories (id, name, depth) values ($1, '심리', 1)`, [CAT]);
  await db.query(
    `insert into courses (id, title, slug, category_id, fee, status, created_at) values
     ($1, '도형심리 1급', 'shape-1', $3, 150000, 'active', '2026-11-20T12:00:00.123Z'),
     ($2, '분류 없음', 'no-cat', null, 0, 'active', '2026-11-21T00:00:00Z')`,
    [C1, C2, CAT],
  );
  await db.query(
    `insert into enrollments (user_id, course_id, status) values ($1, $3, 'approved'), ($2, $3, 'pending'), ($2, $4, 'pending')`,
    [A, B, C1, C2],
  );
  await db.query(`insert into certificates (user_id, course_id, note) values ($1, $3, null), ($2, $3, '수동')`, [A, B, C1]);
  await db.query(`insert into lessons (id, course_id, title) values ($1, $2, '1강')`, [LESSON, C1]);
  await db.query(`insert into quiz_questions (id, lesson_id, question, "order") values ($1, $3, '문1', 1), ($2, $3, '문2', 2)`, [Q1, Q2, LESSON]);
  await db.query(`insert into quiz_options (question_id, label, "order") values ($1, '가', 1), ($1, '나', 2)`, [Q1]);
  app = buildApp({ config, pool: ctx.pool, mailer: new MemoryMailer() });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

function query(payload: unknown, user?: string) {
  const headers: Record<string, string> = { 'x-bara-service-key': KEY };
  if (user) headers['x-bara-session'] = tokens[user];
  return app.inject({ method: 'POST', url: '/v1/query', headers, payload: payload as any });
}

async function ok(payload: unknown, user?: string) {
  const r = await query(payload, user);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { data: any; count: number | null };
}

test('A 세션으로 enrollments 전체 select → A 행만', async () => {
  const { data, count } = await ok({ table: 'enrollments', action: 'select' }, A);
  expect(data).toHaveLength(1);
  expect(data.every((r: any) => r.user_id === A)).toBe(true);
  expect(count).toBeNull();
  const certs = await ok({ table: 'certificates', action: 'select', select: 'user_id, note, courses(slug)' }, A);
  expect(certs.data).toEqual([{ user_id: A, note: null, courses: { slug: 'shape-1' } }]);
});

test('익명으로 enrollments → []', async () => {
  expect((await ok({ table: 'enrollments', action: 'select' })).data).toEqual([]);
});

test('to-one 관계: enrollments의 courses(title, slug, fee) → 객체, fee는 number', async () => {
  const { data } = await ok({ table: 'enrollments', action: 'select', select: 'id, status, courses(title, slug, fee)' }, A);
  expect(data).toEqual([{ id: expect.any(String), status: 'approved', courses: { title: '도형심리 1급', slug: 'shape-1', fee: 150000 } }]);
});

test('to-one 관계가 없는 행 → null', async () => {
  const { data } = await ok({ table: 'courses', action: 'select', select: 'slug, categories(name)', order: [{ col: 'slug', ascending: true }] });
  expect(data).toEqual([
    { slug: 'no-cat', categories: null },
    { slug: 'shape-1', categories: { name: '심리' } },
  ]);
});

test('to-many 관계: quiz_questions의 quiz_options(...) → 배열, 자식 없으면 []', async () => {
  const { data } = await ok(
    { table: 'quiz_questions', action: 'select', select: 'question, quiz_options(label)', order: [{ col: 'order', ascending: true }] },
    M,
  );
  expect(data).toHaveLength(2);
  expect(data[0].question).toBe('문1');
  expect(data[0].quiz_options.map((o: any) => o.label).sort()).toEqual(['가', '나']);
  expect(data[1]).toEqual({ question: '문2', quiz_options: [] });
  expect((await ok({ table: 'quiz_questions', action: 'select', select: '*, quiz_options(*)' }, A)).data).toEqual([]);
});

test('to-many 관계의 별표: 관계 테이블의 모든 열', async () => {
  const { data } = await ok({ table: 'courses', action: 'select', select: 'slug, enrollments(*)', filters: [{ col: 'id', op: 'eq', value: C1 }] }, A);
  expect(data).toHaveLength(1);
  expect(data[0].enrollments).toHaveLength(1);
  expect(Object.keys(data[0].enrollments[0])).toEqual(expect.arrayContaining(['id', 'user_id', 'course_id', 'status', 'payment_due_at']));
  expect(data[0].enrollments[0].user_id).toBe(A);
});

test('timestamptz는 "+00:00" ISO 문자열', async () => {
  const { data } = await ok({ table: 'courses', action: 'select', select: 'created_at', filters: [{ col: 'id', op: 'eq', value: C1 }] });
  expect(data).toEqual([{ created_at: '2026-11-20T12:00:00.123+00:00' }]);
});

test('eq/in/is null/not is null/gte/lte/ilike/order desc/range', async () => {
  const sel = (filters: unknown[], extra: object = {}) =>
    ok({ table: 'courses', action: 'select', select: 'slug', filters, order: [{ col: 'slug', ascending: true }], ...extra });
  expect((await sel([{ col: 'slug', op: 'eq', value: 'shape-1' }])).data).toEqual([{ slug: 'shape-1' }]);
  expect((await sel([{ col: 'slug', op: 'neq', value: 'shape-1' }])).data).toEqual([{ slug: 'no-cat' }]);
  expect((await sel([{ col: 'id', op: 'in', value: [C2, C1] }])).data).toHaveLength(2);
  expect((await sel([{ col: 'id', op: 'in', value: [] }])).data).toEqual([]);
  expect((await sel([{ col: 'category_id', op: 'is', value: null }])).data).toEqual([{ slug: 'no-cat' }]);
  expect((await sel([{ col: 'category_id', op: 'is', value: null, not: true }])).data).toEqual([{ slug: 'shape-1' }]);
  expect((await sel([{ col: 'government_support', op: 'is', value: false }])).data).toHaveLength(2);
  expect((await sel([{ col: 'fee', op: 'gte', value: 100000 }])).data).toEqual([{ slug: 'shape-1' }]);
  expect((await sel([{ col: 'fee', op: 'lte', value: 0 }])).data).toEqual([{ slug: 'no-cat' }]);
  expect((await sel([{ col: 'fee', op: 'gt', value: '0' }])).data).toEqual([{ slug: 'shape-1' }]);
  expect((await sel([{ col: 'title', op: 'ilike', value: '%심리%' }])).data).toEqual([{ slug: 'shape-1' }]);
  expect((await sel([{ col: 'status', op: 'like', value: 'act%' }])).data).toHaveLength(2);
  expect((await sel([{ col: 'requires_exam', op: 'eq', value: false }])).data).toHaveLength(2);
  const desc = await ok({ table: 'courses', action: 'select', select: 'slug', order: [{ col: 'created_at', ascending: false }] });
  expect(desc.data).toEqual([{ slug: 'no-cat' }, { slug: 'shape-1' }]);
  expect((await sel([], { limit: 1, offset: 1 })).data).toEqual([{ slug: 'shape-1' }]);
  expect((await sel([], { limit: 0 })).data).toEqual([]);
});

test("or: name.ilike %홍% 또는 email.ilike — 값에 , ( ) ' 가 있어도 안전", async () => {
  const run = (a: string, b: string) =>
    ok(
      {
        table: 'profiles',
        action: 'select',
        select: 'name',
        filters: [{ or: [{ col: 'name', op: 'ilike', value: a }, { col: 'email', op: 'ilike', value: b }] }],
        order: [{ col: 'name', ascending: true }],
      },
      M,
    );
  expect((await run('%홍%', "%o'brien,(x)%")).data).toEqual([{ name: '김철수' }, { name: '홍길동' }]);
  expect((await run("%'),(%", "%') or true --%")).data).toEqual([]);
  expect((await run('%홍%', '%nobody%')).data).toEqual([{ name: '홍길동' }]);
});

test('count exact + head → data null, count 숫자', async () => {
  expect(await ok({ table: 'enrollments', action: 'select', count: 'exact', head: true }, B)).toEqual({ data: null, count: 2 });
  expect(await ok({ table: 'enrollments', action: 'select', count: 'exact', head: true })).toEqual({ data: null, count: 0 });
  const both = await ok({ table: 'enrollments', action: 'select', select: 'id', count: 'exact', limit: 1 }, B);
  expect(both.data).toHaveLength(1);
  expect(both.count).toBe(2);
});

test('single 0행 → 406 PGRST116, maybeSingle 0행 → null', async () => {
  const none = { table: 'courses', action: 'select', filters: [{ col: 'slug', op: 'eq', value: 'zzz' }] };
  const err = { error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
  const r1 = await query({ ...none, single: 'one' });
  expect(r1.statusCode).toBe(406);
  expect(r1.json()).toEqual(err);
  expect(await ok({ ...none, single: 'maybe' })).toEqual({ data: null, count: null });
  const many = await query({ table: 'courses', action: 'select', single: 'maybe' });
  expect(many.statusCode).toBe(406);
  expect(many.json()).toEqual(err);
  expect((await query({ table: 'courses', action: 'select', single: 'one' })).statusCode).toBe(406);
  const one = await ok({ table: 'courses', action: 'select', select: 'slug', single: 'one', filters: [{ col: 'id', op: 'eq', value: C1 }] });
  expect(one).toEqual({ data: { slug: 'shape-1' }, count: null });
});

test('없는 테이블·없는 열·관계 안 관계·limit 1001 → 400', async () => {
  const bad = [
    { table: 'nope', action: 'select' },
    { table: 'courses', action: 'select', select: 'id, nope' },
    { table: 'courses', action: 'select', filters: [{ col: 'nope', op: 'eq', value: 1 }] },
    { table: 'courses', action: 'select', order: [{ col: 'nope', ascending: true }] },
    { table: 'enrollments', action: 'select', select: 'id, courses(id, categories(name))' },
    { table: 'courses', action: 'select', limit: 1001 },
    { table: 'courses', action: 'select', limit: -1 },
    { table: 'courses', action: 'select', offset: 1.5 },
    { table: 'courses', action: 'select', extra: 1 },
    { table: 'courses', action: 'select', filters: [{ col: 'id', op: 'eq', value: { x: 1 } }] },
    { table: 'courses', action: 'select', filters: [{ col: 'id', op: 'raw', value: '1' }] },
    { table: 'courses', action: 'select', filters: [{ col: 'id', op: 'eq', value: 1, junk: 1 }] },
    { table: 'courses', action: 'merge', values: { title: 'x' } },
    { table: 'courses' },
    [],
  ];
  for (const p of bad) {
    const r = await query(p, A);
    expect(r.statusCode, JSON.stringify(p)).toBe(400);
    expect(r.json().error.code).toBe('validation');
  }
});

test('잘못된 값 형식(uuid) → 400 validation, 내부 문구 없음', async () => {
  const r = await query({ table: 'courses', action: 'select', filters: [{ col: 'id', op: 'eq', value: 'not-a-uuid' }] });
  expect(r.statusCode).toBe(400);
  expect(r.json()).toEqual({ error: { code: 'validation', message: '요청 값이 올바르지 않습니다.' } });
});

test('auth 스키마 테이블(auth.users) 지정 불가 → 400', async () => {
  for (const table of ['auth.users', 'users', 'sessions', '"auth"."users"', 'pg_catalog.pg_roles', 'pg_roles']) {
    const r = await query({ table, action: 'select' }, M);
    expect(r.statusCode, table).toBe(400);
  }
  const rel = await query({ table: 'profiles', action: 'select', select: 'id, users(email)' }, M);
  expect(rel.statusCode).toBe(400);
});

test('서비스 키 없으면 401', async () => {
  const r = await app.inject({ method: 'POST', url: '/v1/query', payload: { table: 'courses', action: 'select' } });
  expect(r.statusCode).toBe(401);
});
