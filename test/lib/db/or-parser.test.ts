import { expect, test } from 'vitest';
import { parseOr } from '@/lib/db/or-parser';

test("parseOr('status.eq.approved,and(status.eq.pending,payment_due_at.gte.2026-11-20T00:00:00Z)')", () => {
  expect(parseOr('status.eq.approved,and(status.eq.pending,payment_due_at.gte.2026-11-20T00:00:00Z)')).toEqual([
    { col: 'status', op: 'eq', value: 'approved' },
    {
      and: [
        { col: 'status', op: 'eq', value: 'pending' },
        { col: 'payment_due_at', op: 'gte', value: '2026-11-20T00:00:00Z' },
      ],
    },
  ]);
});

test("parseOr('name.ilike.%홍길동%,email.ilike.%홍길동%')", () => {
  expect(parseOr('name.ilike.%홍길동%,email.ilike.%홍길동%')).toEqual([
    { col: 'name', op: 'ilike', value: '%홍길동%' },
    { col: 'email', op: 'ilike', value: '%홍길동%' },
  ]);
});

test('값 안의 점은 그대로 둔다 (밀리초 타임스탬프, 이메일 검색어)', () => {
  expect(parseOr('a.gte.2026-11-20T00:00:00.000Z,email.ilike.%a.b@c.kr%')).toEqual([
    { col: 'a', op: 'gte', value: '2026-11-20T00:00:00.000Z' },
    { col: 'email', op: 'ilike', value: '%a.b@c.kr%' },
  ]);
});

test('is 연산자는 null/true/false로 바꾼다', () => {
  expect(parseOr('a.is.null,b.is.true')).toEqual([
    { col: 'a', op: 'is', value: null },
    { col: 'b', op: 'is', value: true },
  ]);
});

test.each([
  ['', '빈 문자열'],
  ['status.eq.a,', '빈 항목'],
  ['status', '연산자 없음'],
  ['status.eq', '값 없음'],
  ['status.foo.a', '모르는 연산자'],
  ['and(status.eq.a', '닫는 괄호 없음'],
  ['status.eq.a)', '여는 괄호 없음'],
  ['status.eq.a(b)', '값 안의 괄호'],
  ['and()', '빈 and'],
  ['a.is.maybe', 'is 값 오류'],
])('파싱할 수 없는 문자열은 throw: %s (%s)', (input) => {
  expect(() => parseOr(input)).toThrow();
});
