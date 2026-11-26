import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const M = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const C1 = '22222222-2222-4222-8222-222222222222';
const L1 = '44444444-4444-4444-8444-444444444444';
const L2 = '55555555-5555-4555-8555-555555555555';

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  ctx = await setupTestDb();
  const db = ctx.adminPool;
  for (const [id, name, email] of [
    [A, '홍길동', 'hong@example.com'],
    [B, '김철수', 'kim@example.com'],
    [M, '관리자', 'admin@example.com'],
  ]) {
    await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, JSON.stringify({ name })]);
    tokens[id] = (await createSession(ctx.pool, id, 30, { mfaMethod: 'totp' })).token;
  }
  await db.query(`begin; set local session_replication_role = replica; update profiles set role='admin' where id='${M}'; commit`);
  await db.query(`insert into courses (id, title, slug, fee, status) values ($1, '도형심리 1급', 'shape-1', 150000, 'active')`, [C1]);
  await db.query(`insert into lessons (id, course_id, title) values ($1, $3, '1강'), ($2, $3, '2강')`, [L1, L2, C1]);
  await db.query(`insert into bank_accounts (bank_name, account_number, account_holder) values ('국민', '1', '바라'), ('신한', '2', '바라')`);
  // no public table has a json/jsonb column today; this one exercises the json binding path
  await db.query(`set role bara_edu_service;
    create table public.write_probe (id serial primary key, doc jsonb, note text);
    grant select, insert, update, delete on public.write_probe to bara_edu_anon, bara_edu_authenticated;
    grant usage on all sequences in schema public to bara_edu_anon, bara_edu_authenticated;
    reset role`);
  app = buildApp({ config, pool: ctx.pool, mailer: new MemoryMailer(), storage: new MemoryStorage() });
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

async function fails(payload: unknown, user: string | undefined, status: number, code: string) {
  const r = await query(payload, user);
  expect(r.statusCode, `${JSON.stringify(payload).slice(0, 200)} → ${r.body}`).toBe(status);
  expect(r.json().error.code).toBe(code);
  return r.json().error as { code: string; message: string; sqlstate?: string };
}

test('A가 본인 progress upsert(onConflict user_id,lesson_id) 두 번 → 1행, completed_at 갱신', async () => {
  const up = (at: string) =>
    ok(
      {
        table: 'progress',
        action: 'upsert',
        values: { user_id: A, lesson_id: L1, completed_at: at },
        onConflict: 'user_id, lesson_id',
        returning: true,
        select: 'lesson_id, completed_at',
      },
      A,
    );
  expect((await up('2026-11-20T01:00:00Z')).data).toEqual([{ lesson_id: L1, completed_at: '2026-11-20T01:00:00+00:00' }]);
  expect((await up('2026-11-21T02:00:00.5Z')).data).toEqual([{ lesson_id: L1, completed_at: '2026-11-21T02:00:00.5+00:00' }]);
  const rows = await ctx.adminPool.query('select completed_at from progress where user_id = $1', [A]);
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0].completed_at.toISOString()).toBe('2026-11-21T02:00:00.500Z');
  const plain = await ok({ table: 'progress', action: 'upsert', values: { user_id: A, lesson_id: L1, completed_at: null }, onConflict: 'user_id,lesson_id' }, A);
  expect(plain).toEqual({ data: null, count: null });
});

test('A가 B의 profiles update → 0행 영향, data null, 오류 없음(RLS)', async () => {
  const filters = [{ col: 'id', op: 'eq', value: B }];
  expect(await ok({ table: 'profiles', action: 'update', values: { name: '해커' }, filters }, A)).toEqual({ data: null, count: null });
  expect((await ok({ table: 'profiles', action: 'update', values: { name: '해커' }, filters, returning: true }, A)).data).toEqual([]);
  const r = await ctx.adminPool.query('select name from profiles where id = $1', [B]);
  expect(r.rows[0].name).toBe('김철수');
});

test('filters 없는 update/delete → 400', async () => {
  await fails({ table: 'profiles', action: 'update', values: { name: 'x' } }, M, 400, 'validation');
  await fails({ table: 'profiles', action: 'update', values: { name: 'x' }, filters: [] }, M, 400, 'validation');
  await fails({ table: 'progress', action: 'delete' }, M, 400, 'validation');
  await fails({ table: 'progress', action: 'delete', filters: [] }, M, 400, 'validation');
  const names = await ctx.adminPool.query(`select count(*)::int as n from profiles where name = 'x'`);
  expect(names.rows[0].n).toBe(0);
});

test('bank_accounts 4번째 insert → 400 db_error, message에 "bank account limit reached"', async () => {
  const add = (n: string) => query({ table: 'bank_accounts', action: 'insert', values: { bank_name: '우리', account_number: n, account_holder: '바라' } }, M);
  expect((await add('3')).statusCode).toBe(200);
  const err = await fails({ table: 'bank_accounts', action: 'insert', values: { bank_name: '하나', account_number: '4', account_holder: '바라' } }, M, 400, 'db_error');
  expect(err.message).toContain('bank account limit reached');
  expect(err.sqlstate).toBe('P0001');
});

test('unique 위반 → 400 db_error, sqlstate "23505"', async () => {
  const ins = { table: 'enrollments', action: 'insert', values: { user_id: A, course_id: C1, status: 'pending' } };
  expect((await query(ins, A)).statusCode).toBe(200);
  const err = await fails(ins, A, 400, 'db_error');
  expect(err.sqlstate).toBe('23505');
  expect(err.message).toContain('duplicate key');
});

test('insert + returning select "id, created_at" → 새 행 배열', async () => {
  const { data } = await ok(
    { table: 'courses', action: 'insert', values: { title: '새 강좌', slug: 'new-1', fee: 1000 }, returning: true, select: 'id, created_at' },
    M,
  );
  expect(data).toEqual([{ id: expect.any(String), created_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT[\d:.]+\+00:00$/) }]);
  const many = await ok(
    {
      table: 'courses',
      action: 'insert',
      values: [
        { title: '둘', slug: 'new-2', fee: 2000 },
        { title: '셋', slug: 'new-3' },
      ],
      returning: true,
      select: 'slug, fee, status',
    },
    M,
  );
  expect(many.data).toEqual([
    { slug: 'new-2', fee: 2000, status: 'upcoming' },
    { slug: 'new-3', fee: 0, status: 'upcoming' },
  ]);
});

test('returning에 관계 포함(lessons → courses), single one → 객체', async () => {
  const r = await ok(
    { table: 'lessons', action: 'insert', values: { course_id: C1, title: '3강' }, returning: true, select: 'title, courses(slug)', single: 'one' },
    M,
  );
  expect(r).toEqual({ data: { title: '3강', courses: { slug: 'shape-1' } }, count: null });
  const none = await query({ table: 'profiles', action: 'update', values: { name: 'y' }, filters: [{ col: 'id', op: 'eq', value: B }], returning: true, single: 'one' }, A);
  expect(none.statusCode).toBe(406);
});

test('여러 행에 맞는 쓰기 + single → 406, 변경은 롤백', async () => {
  await ctx.adminPool.query(`insert into courses (title, slug) values ('원1', 'multi-1'), ('원2', 'multi-2')`);
  const slugs = (await ctx.adminPool.query(`select slug, title from courses order by slug`)).rows;
  const many = [{ col: 'slug', op: 'in', value: ['multi-1', 'multi-2'] }];
  const up = await query({ table: 'courses', action: 'update', values: { title: '바뀜' }, filters: many, returning: true, single: 'one' }, M);
  expect(up.statusCode).toBe(406);
  expect(up.json().error.code).toBe('PGRST116');
  const del = await query({ table: 'courses', action: 'delete', filters: many, returning: true, single: 'maybe' }, M);
  expect(del.statusCode).toBe(406);
  expect((await ctx.adminPool.query(`select slug, title from courses order by slug`)).rows).toEqual(slugs);
  const one = await ok({ table: 'courses', action: 'insert', values: { title: '넷', slug: 'multi-3' }, returning: true, select: 'slug', single: 'maybe' }, M);
  expect(one).toEqual({ data: { slug: 'multi-3' }, count: null });
});

test('update 본인 profiles → 반영, delete 본인 progress → 반환', async () => {
  const u = await ok(
    { table: 'profiles', action: 'update', values: { name: '홍길순', phone: null }, filters: [{ col: 'id', op: 'eq', value: A }], returning: true, select: 'name, phone' },
    A,
  );
  expect(u.data).toEqual([{ name: '홍길순', phone: null }]);
  await ok({ table: 'progress', action: 'insert', values: { user_id: A, lesson_id: L2 } }, A);
  const d = await ok({ table: 'progress', action: 'delete', filters: [{ col: 'lesson_id', op: 'eq', value: L2 }], returning: true, select: 'lesson_id' }, A);
  expect(d.data).toEqual([{ lesson_id: L2 }]);
  expect(await ok({ table: 'progress', action: 'delete', filters: [{ col: 'lesson_id', op: 'eq', value: L2 }] }, A)).toEqual({ data: null, count: null });
});

test('일반 회원 role 승격 시도(profiles.role="admin" update) → 기존 트리거가 조용히 되돌림(200, role learner 유지)', async () => {
  const self = await ok(
    { table: 'profiles', action: 'update', values: { role: 'admin' }, filters: [{ col: 'id', op: 'eq', value: A }], returning: true, select: 'role' },
    A,
  );
  expect(self.data).toEqual([{ role: 'learner' }]);
  const anon = await ok({ table: 'profiles', action: 'update', values: { role: 'admin' }, filters: [{ col: 'id', op: 'eq', value: A }], returning: true });
  expect(anon.data).toEqual([]);
  const r = await ctx.adminPool.query('select role from profiles where id = $1', [A]);
  expect(r.rows[0].role).toBe('learner');
});

test('RLS with check 위반(일반 회원 courses insert) → 403 db_error 42501', async () => {
  const err = await fails({ table: 'courses', action: 'insert', values: { title: 'x', slug: 'hack' } }, A, 403, 'db_error');
  expect(err.sqlstate).toBe('42501');
});

test('json/jsonb 열만 객체·배열 허용, 그 외 열은 400', async () => {
  const { data } = await ok(
    {
      table: 'write_probe',
      action: 'insert',
      values: [{ doc: { a: [1, 'x'], b: null }, note: 'n' }, { doc: [1, 2] }, { doc: 'plain' }, { doc: null }],
      returning: true,
      select: 'doc, note',
    },
    A,
  );
  expect(data).toEqual([
    { doc: { a: [1, 'x'], b: null }, note: 'n' },
    { doc: [1, 2], note: null },
    { doc: 'plain', note: null },
    { doc: null, note: null },
  ]);
  await fails({ table: 'write_probe', action: 'insert', values: { note: { a: 1 } } }, A, 400, 'validation');
  await fails({ table: 'write_probe', action: 'insert', values: { note: ['a'] } }, A, 400, 'validation');
  await fails({ table: 'profiles', action: 'update', values: { name: ['x'] }, filters: [{ col: 'id', op: 'eq', value: A }] }, A, 400, 'validation');
});

test('잘못된 값(class 22: uuid 형식) → 400 validation, 내부 문구 없음', async () => {
  const r = await query({ table: 'progress', action: 'insert', values: { user_id: 'nope', lesson_id: L1 } }, A);
  expect(r.statusCode).toBe(400);
  expect(r.json()).toEqual({ error: { code: 'validation', message: '요청 값이 올바르지 않습니다.' } });
});

test('잘못된 쓰기 요청 형식 → 400 validation', async () => {
  const f = [{ col: 'id', op: 'eq', value: A }];
  const bad = [
    { table: 'profiles', action: 'insert' },
    { table: 'profiles', action: 'insert', values: [] },
    { table: 'profiles', action: 'insert', values: {} },
    { table: 'profiles', action: 'insert', values: { nope: 1 } },
    { table: 'profiles', action: 'insert', values: { name: 'x' }, filters: f },
    { table: 'profiles', action: 'insert', values: { name: 'x' }, onConflict: 'id' },
    { table: 'profiles', action: 'insert', values: { name: 'x' }, select: 'id' },
    { table: 'profiles', action: 'insert', values: { name: 'x' }, single: 'one' },
    { table: 'profiles', action: 'insert', values: { name: 'x' }, returning: true, select: 'nope' },
    { table: 'profiles', action: 'insert', values: { name: 'x' }, count: 'exact' },
    { table: 'profiles', action: 'update', values: [{ name: 'x' }], filters: f },
    { table: 'profiles', action: 'update', values: {}, filters: f },
    { table: 'profiles', action: 'update', filters: f },
    { table: 'profiles', action: 'delete', values: { name: 'x' }, filters: f },
    { table: 'progress', action: 'upsert', values: { user_id: A, lesson_id: L1 } },
    { table: 'progress', action: 'upsert', values: { user_id: A, lesson_id: L1 }, onConflict: '' },
    { table: 'progress', action: 'upsert', values: { user_id: A, lesson_id: L1 }, onConflict: 'user_id,nope' },
    { table: 'progress', action: 'upsert', values: { user_id: A, lesson_id: L1 }, onConflict: 'user_id,user_id' },
    { table: 'progress', action: 'upsert', values: { user_id: A, lesson_id: L1 }, onConflict: 'user_id' },
    { table: 'nope', action: 'insert', values: { a: 1 } },
    { table: 'profiles', action: 'merge', values: { name: 'x' } },
  ];
  for (const p of bad) await fails(p, A, 400, 'validation');
});

test('or/and 중첩 깊이 4 초과·필터 100개 초과 → 400 validation(깊은 본문도 500 아님)', async () => {
  const leaf = { col: 'slug', op: 'eq', value: 'shape-1' };
  const nest = (n: number) => {
    let f: unknown = leaf;
    for (let i = 0; i < n; i++) f = { [i % 2 ? 'and' : 'or']: [f] };
    return f;
  };
  expect((await ok({ table: 'courses', action: 'select', select: 'slug', filters: [nest(4)] })).data).toEqual([{ slug: 'shape-1' }]);
  await fails({ table: 'courses', action: 'select', filters: [nest(5)] }, undefined, 400, 'validation');
  await fails({ table: 'courses', action: 'select', filters: [nest(2000)] }, undefined, 400, 'validation');
  await fails({ table: 'courses', action: 'delete', filters: [nest(2000)] }, M, 400, 'validation');
  expect((await ok({ table: 'courses', action: 'select', select: 'slug', filters: Array(100).fill(leaf) })).data).toEqual([{ slug: 'shape-1' }]);
  await fails({ table: 'courses', action: 'select', filters: Array(101).fill(leaf) }, undefined, 400, 'validation');
  await fails({ table: 'courses', action: 'select', filters: [{ or: Array(100).fill(leaf) }] }, undefined, 400, 'validation');
});
