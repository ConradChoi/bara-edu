import { expect, test } from 'vitest';
import { parseSelect } from '../src/query/select-parser.js';
import { makeCatalog } from '../src/query/catalog.js';
import { buildCount, buildSelect, QueryError } from '../src/query/build.js';
import { toDbError } from '../src/query/db-error.js';

test('parseSelect: 열·별표·1단계 관계', () => {
  expect(parseSelect('id, courses(title, slug)')).toEqual([
    { kind: 'col', name: 'id' },
    { kind: 'rel', name: 'courses', children: [{ kind: 'col', name: 'title' }, { kind: 'col', name: 'slug' }] },
  ]);
  expect(parseSelect('*, c(*)')).toEqual([{ kind: 'star' }, { kind: 'rel', name: 'c', children: [{ kind: 'star' }] }]);
  expect(parseSelect('\n  id,\n  name\n')).toEqual([
    { kind: 'col', name: 'id' },
    { kind: 'col', name: 'name' },
  ]);
  expect(() => parseSelect('a(b(c))')).toThrow();
});

test.each(['', ' ', 'a,', ',a', 'a,,b', 'a b', 'a(', 'a)', 'a()', 'x:a', 'a::text', 'c!inner(a)', 'a"b', 'count()', '"a"', 'a;b', 'a(b),'])(
  'parseSelect 거부: %j',
  (s) => {
    expect(() => parseSelect(s)).toThrow();
  },
);

const cat = makeCatalog(
  new Map([
    ['enrollments', ['id', 'user_id', 'course_id', 'status']],
    ['courses', ['id', 'title', 'fee', 'category_id']],
    ['categories', ['id', 'name', 'parent_id']],
    ['quiz_questions', ['id', 'question']],
    ['quiz_options', ['id', 'question_id', 'label']],
    ['pairs', ['id', 'a_id', 'b_id']],
    ['people', ['id']],
  ]),
  [
    { table: 'enrollments', cols: ['course_id'], refTable: 'courses', refCols: ['id'] },
    { table: 'courses', cols: ['category_id'], refTable: 'categories', refCols: ['id'] },
    { table: 'categories', cols: ['parent_id'], refTable: 'categories', refCols: ['id'] },
    { table: 'quiz_options', cols: ['question_id'], refTable: 'quiz_questions', refCols: ['id'] },
    { table: 'pairs', cols: ['a_id'], refTable: 'people', refCols: ['id'] },
    { table: 'pairs', cols: ['b_id'], refTable: 'people', refCols: ['id'] },
  ],
);

test('catalog.relation: FK 방향으로 one/many, 후보 둘 이상이면 undefined', () => {
  expect(cat.relation('enrollments', 'courses')).toEqual({ kind: 'one', fromCols: ['course_id'], toCols: ['id'] });
  expect(cat.relation('courses', 'enrollments')).toEqual({ kind: 'many', fromCols: ['id'], toCols: ['course_id'] });
  expect(cat.relation('categories', 'categories')).toBeUndefined();
  expect(cat.relation('pairs', 'people')).toBeUndefined();
  expect(cat.relation('enrollments', 'categories')).toBeUndefined();
  expect(cat.columns('nope')).toBeUndefined();
  expect([...cat.columns('courses')!]).toEqual(['id', 'title', 'fee', 'category_id']);
});

test('buildSelect: 식별자는 따옴표, 값은 바인딩, 관계 서브쿼리', () => {
  const q = buildSelect(cat, {
    table: 'enrollments',
    action: 'select',
    select: 'id, courses(title, fee)',
    filters: [
      { col: 'status', op: 'eq', value: "x'); drop table y; --" },
      { or: [{ col: 'id', op: 'in', value: ['a', 'b'] }, { col: 'course_id', op: 'is', value: null, not: true }] },
    ],
    order: [{ col: 'id', ascending: false }],
    limit: 10,
    offset: 5,
  });
  expect(q.text).toBe(
    `select coalesce(json_agg(t), '[]'::json) as data from (select t0."id", ` +
      `(select json_build_object('title', r1."title", 'fee', r1."fee") from "public"."courses" r1 where r1."id" = t0."course_id") as "courses" ` +
      `from "public"."enrollments" t0 where t0."status" = $1 and (t0."id" = any($2) or t0."course_id" is not null) ` +
      `order by t0."id" desc limit $3 offset $4) t`,
  );
  expect(q.values).toEqual(["x'); drop table y; --", ['a', 'b'], 10, 5]);
});

test('buildSelect: 1:N 관계와 별표', () => {
  const q = buildSelect(cat, { table: 'quiz_questions', action: 'select', select: 'id, quiz_options(*)' });
  expect(q.text).toBe(
    `select coalesce(json_agg(t), '[]'::json) as data from (select t0."id", ` +
      `coalesce((select json_agg(json_build_object('id', r1."id", 'question_id', r1."question_id", 'label', r1."label")) from "public"."quiz_options" r1 where r1."question_id" = t0."id"), '[]'::json) as "quiz_options" ` +
      `from "public"."quiz_questions" t0) t`,
  );
  expect(q.values).toEqual([]);
});

test('buildSelect: 기본 select는 모든 열, like/ilike는 text 비교, and 중첩', () => {
  const q = buildSelect(cat, {
    table: 'courses',
    action: 'select',
    filters: [{ and: [{ col: 'title', op: 'ilike', value: '%a%' }, { col: 'fee', op: 'gte', value: 1 }] }],
  });
  expect(q.text).toBe(
    `select coalesce(json_agg(t), '[]'::json) as data from (select t0."id", t0."title", t0."fee", t0."category_id" ` +
      `from "public"."courses" t0 where (t0."title"::text ilike $1 and t0."fee" >= $2)) t`,
  );
});

test('buildCount: 같은 where로 count', () => {
  const q = buildCount(cat, { table: 'courses', action: 'select', filters: [{ col: 'fee', op: 'lt', value: 3 }], limit: 1 });
  expect(q).toEqual({ text: `select count(*)::int as count from "public"."courses" t0 where t0."fee" < $1`, values: [3] });
});

test.each([
  ['없는 테이블', { table: 'nope' }],
  ['스키마 지정', { table: 'auth.users' }],
  ['없는 열', { table: 'courses', select: 'id, nope' }],
  ['없는 관계', { table: 'courses', select: 'id, quiz_options(id)' }],
  ['모호한 관계', { table: 'categories', select: 'id, categories(id)' }],
  ['관계 안의 없는 열', { table: 'enrollments', select: 'courses(nope)' }],
  ['필터의 없는 열', { table: 'courses', filters: [{ col: 'nope', op: 'eq', value: 1 }] }],
  ['or 안의 없는 열', { table: 'courses', filters: [{ or: [{ col: 'nope', op: 'eq', value: 1 }] }] }],
  ['정렬의 없는 열', { table: 'courses', order: [{ col: 'nope', ascending: true }] }],
  ['중복 열', { table: 'courses', select: 'id, id' }],
  ['빈 or', { table: 'courses', filters: [{ or: [] }] }],
])('buildSelect 거부: %s', (_name, req) => {
  expect(() => buildSelect(cat, { action: 'select', ...req } as any)).toThrow(QueryError);
});

test('toDbError: SQLSTATE 규칙', () => {
  expect(toDbError({ code: '23505', message: 'dup' })).toEqual({
    status: 400,
    body: { error: { code: 'db_error', message: 'dup', sqlstate: '23505' } },
  });
  expect(toDbError({ code: 'P0001', message: 'result not found' })?.status).toBe(400);
  expect(toDbError({ code: '42501', message: 'permission denied' })).toEqual({
    status: 403,
    body: { error: { code: 'db_error', message: 'permission denied', sqlstate: '42501' } },
  });
  expect(toDbError({ code: '22P02', message: 'invalid input syntax for type uuid: "x"' })).toEqual({
    status: 400,
    body: { error: { code: 'validation', message: '요청 값이 올바르지 않습니다.' } },
  });
  expect(toDbError({ code: '42P01', message: 'secret' })).toBeNull();
  expect(toDbError(new Error('x'))).toBeNull();
  expect(toDbError(null)).toBeNull();
});
