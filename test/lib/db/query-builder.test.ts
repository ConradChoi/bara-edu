import { beforeEach, expect, test, vi } from 'vitest';

const apiFetch = vi.fn();
let session: string | null = 'tok';
vi.mock('@/lib/db/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock('@/lib/db/session-cookie', () => ({ readSession: async () => session }));

import { createClient } from '@/lib/db/server';

const ok = (data: unknown) => ({ ok: true, data });
const fail = (status: number, error: unknown) => ({ ok: false, status, error });
const lastCall = () => apiFetch.mock.calls.at(-1)!;

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue(ok({ data: [], count: null }));
  session = 'tok';
});

test("from('enrollments').select('id, courses(title)').eq('user_id', u).order('created_at', {ascending:false}) → 요청 본문", async () => {
  const rows = [{ id: 'e1', courses: { title: 'T' } }];
  apiFetch.mockResolvedValue(ok({ data: rows, count: null }));
  const db = await createClient();
  const r = await db.from('enrollments').select('id, courses(title)').eq('user_id', 'u1').order('created_at', { ascending: false });
  expect(r).toEqual({ data: rows, error: null, count: null });
  expect(lastCall()).toEqual([
    '/v1/query',
    {
      method: 'POST',
      session: 'tok',
      body: {
        table: 'enrollments',
        action: 'select',
        select: 'id, courses(title)',
        filters: [{ col: 'user_id', op: 'eq', value: 'u1' }],
        order: [{ col: 'created_at', ascending: false }],
      },
    },
  ]);
});

test("select('id', {count:'exact', head:true}) → count만", async () => {
  apiFetch.mockResolvedValue(ok({ data: null, count: 7 }));
  const db = await createClient();
  const r = await db.from('lessons').select('id', { count: 'exact', head: true }).eq('course_id', 'c1');
  expect(r).toEqual({ data: null, error: null, count: 7 });
  expect(lastCall()[1].body).toEqual({
    table: 'lessons',
    action: 'select',
    select: 'id',
    count: 'exact',
    head: true,
    filters: [{ col: 'course_id', op: 'eq', value: 'c1' }],
  });
});

test('update().eq() 뒤 .select() → returning true', async () => {
  apiFetch.mockResolvedValue(ok({ data: { id: 'x' }, count: null }));
  const db = await createClient();
  const r = await db.from('courses').update({ title: 'n' }).eq('id', 'x').select('id').single();
  expect(r.data).toEqual({ id: 'x' });
  expect(lastCall()[1].body).toEqual({
    table: 'courses',
    action: 'update',
    values: { title: 'n' },
    filters: [{ col: 'id', op: 'eq', value: 'x' }],
    returning: true,
    select: 'id',
    single: 'one',
  });
});

test('select() 없는 쓰기는 returning을 보내지 않고, insert는 filters 키를 보내지 않는다', async () => {
  apiFetch.mockResolvedValue(ok({ data: null, count: null }));
  const db = await createClient();
  expect(await db.from('notes').insert({ a: 1 })).toEqual({ data: null, error: null, count: null });
  expect(lastCall()[1].body).toEqual({ table: 'notes', action: 'insert', values: { a: 1 } });
  await db.from('progress').upsert([{ a: 1 }], { onConflict: 'user_id,lesson_id' });
  expect(lastCall()[1].body).toEqual({ table: 'progress', action: 'upsert', values: [{ a: 1 }], onConflict: 'user_id,lesson_id' });
  await db.from('notes').delete().in('id', ['a', 'b']);
  expect(lastCall()[1].body).toEqual({ table: 'notes', action: 'delete', filters: [{ col: 'id', op: 'in', value: ['a', 'b'] }] });
});

test('API 오류 sqlstate 23505 → error.code "23505"', async () => {
  apiFetch.mockResolvedValue(fail(400, { code: 'db_error', message: 'duplicate key value violates unique constraint', sqlstate: '23505' }));
  const db = await createClient();
  const r = await db.from('courses').insert({ slug: 'x' });
  expect(r).toEqual({ data: null, count: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
});

test('sqlstate 없는 오류는 code 그대로, single 불일치는 PGRST116', async () => {
  const db = await createClient();
  apiFetch.mockResolvedValue(fail(503, { code: 'unavailable', message: 'down' }));
  expect((await db.from('a').select()).error).toEqual({ code: 'unavailable', message: 'down' });
  apiFetch.mockResolvedValue(fail(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }));
  expect((await db.from('a').select().eq('id', 'x').single()).error?.code).toBe('PGRST116');
});

test('모든 필터 연산자·range·limit·maybeSingle 본문', async () => {
  apiFetch.mockResolvedValue(ok({ data: null, count: null }));
  const db = await createClient();
  const r = await db
    .from('t')
    .select('*')
    .neq('a', 1)
    .gt('b', 2)
    .gte('c', '2026-01-01')
    .lt('d', 3)
    .lte('e', 4)
    .like('f', 'x%')
    .ilike('g', '%y%')
    .is('h', null)
    .not('i', 'is', null)
    .or('j.eq.1,k.eq.2')
    .range(20, 29)
    .maybeSingle();
  expect(r).toEqual({ data: null, error: null, count: null });
  expect(lastCall()[1].body).toEqual({
    table: 't',
    action: 'select',
    select: '*',
    filters: [
      { col: 'a', op: 'neq', value: 1 },
      { col: 'b', op: 'gt', value: 2 },
      { col: 'c', op: 'gte', value: '2026-01-01' },
      { col: 'd', op: 'lt', value: 3 },
      { col: 'e', op: 'lte', value: 4 },
      { col: 'f', op: 'like', value: 'x%' },
      { col: 'g', op: 'ilike', value: '%y%' },
      { col: 'h', op: 'is', value: null },
      { col: 'i', op: 'is', value: null, not: true },
      { or: [{ col: 'j', op: 'eq', value: '1' }, { col: 'k', op: 'eq', value: '2' }] },
    ],
    offset: 20,
    limit: 10,
    single: 'maybe',
  });
  await db.from('t').select('id').limit(1);
  expect(lastCall()[1].body).toEqual({ table: 't', action: 'select', select: 'id', limit: 1 });
});

test('빌더는 재사용 시 앞 조건을 유지하고 Promise.all에서 동작한다', async () => {
  apiFetch.mockImplementation(async (_p: string, init: { body: { table: string } }) => ok({ data: [init.body.table], count: null }));
  const db = await createClient();
  let q = db.from('profiles').select('id');
  q = q.eq('role', 'learner');
  const [a, b] = await Promise.all([q, db.from('courses').select('id')]);
  expect(a.data).toEqual(['profiles']);
  expect(b.data).toEqual(['courses']);
  expect(apiFetch.mock.calls[0][1].body.filters).toEqual([{ col: 'role', op: 'eq', value: 'learner' }]);
});

test('세션 쿠키가 없으면 session null로 보낸다', async () => {
  session = null;
  const db = await createClient();
  await db.from('courses').select('id');
  expect(lastCall()[1].session).toBeNull();
});

test('관계 안의 관계(API 미지원)는 요청을 만들 때 바로 throw', async () => {
  const db = await createClient();
  expect(() => db.from('a').select('id, b(id, c(id))')).toThrow(/nested embed/);
  expect(() => db.from('a').insert({ x: 1 }).select('id, b(c(id))')).toThrow(/nested embed/);
  expect(() => db.from('a').select('id, b(id), c(id)')).not.toThrow();
  expect(apiFetch).not.toHaveBeenCalled();
});

test('rpc(fn, args) → /v1/rpc/:fn 본문 {args}', async () => {
  apiFetch.mockResolvedValue(ok({ data: [{ id: 1 }] }));
  const db = await createClient();
  expect(await db.rpc('get_course_exam', { p_course_id: 'c' })).toEqual({ data: [{ id: 1 }], error: null });
  expect(lastCall()).toEqual(['/v1/rpc/get_course_exam', { method: 'POST', session: 'tok', body: { args: { p_course_id: 'c' } } }]);
  await db.rpc('get_my_diagnosis_results');
  expect(lastCall()[1].body).toEqual({ args: {} });
});

test('rpc 오류는 sqlstate 우선 (P0001 메시지 유지)', async () => {
  apiFetch.mockResolvedValue(fail(400, { code: 'db_error', message: 'result not found', sqlstate: 'P0001' }));
  const db = await createClient();
  expect(await db.rpc('get_diagnosis_summary', { p_token: 't' }).maybeSingle()).toEqual({
    data: null,
    error: { code: 'P0001', message: 'result not found' },
  });
});

test('rpc().single()/maybeSingle()은 행 배열을 한 행으로 줄인다', async () => {
  const db = await createClient();
  apiFetch.mockResolvedValue(ok({ data: [{ score: 1 }] }));
  expect(await db.rpc('submit_quiz_attempt', {}).single()).toEqual({ data: { score: 1 }, error: null });
  apiFetch.mockResolvedValue(ok({ data: [] }));
  expect(await db.rpc('get_diagnosis_detail', {}).maybeSingle()).toEqual({ data: null, error: null });
  expect((await db.rpc('get_diagnosis_detail', {}).single()).error?.code).toBe('PGRST116');
  apiFetch.mockResolvedValue(ok({ data: [{ a: 1 }, { a: 2 }] }));
  expect((await db.rpc('get_diagnosis_detail', {}).maybeSingle()).error?.code).toBe('PGRST116');
  apiFetch.mockResolvedValue(ok({ data: { a: 1 } }));
  expect(await db.rpc('x', {}).single()).toEqual({ data: { a: 1 }, error: null });
});

test('auth.getUser: 쿠키 없으면 API를 부르지 않고 user null', async () => {
  session = null;
  const db = await createClient();
  expect(await db.auth.getUser()).toEqual({ data: { user: null }, error: null });
  expect(apiFetch).not.toHaveBeenCalled();
});

test('auth.getUser: 세션 조회 성공 → {id,email}, 401 → null', async () => {
  const db = await createClient();
  apiFetch.mockResolvedValue(ok({ user: { id: 'u1', email: 'a@b.kr', emailConfirmedAt: null }, profile: null }));
  expect(await db.auth.getUser()).toEqual({ data: { user: { id: 'u1', email: 'a@b.kr' } }, error: null });
  expect(lastCall()).toEqual(['/v1/auth/session', { method: 'GET', session: 'tok' }]);
  session = 'tok-expired';
  apiFetch.mockResolvedValue(fail(401, { code: 'unauthenticated', message: '로그인이 필요합니다.' }));
  expect(await db.auth.getUser()).toEqual({ data: { user: null }, error: null });
});
