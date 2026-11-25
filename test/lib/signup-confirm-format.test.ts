import { expect, test } from 'vitest';
import { formatRemaining, formatRequestedAt } from '@/lib/signup-confirm-format';

test('가입 요청 시각은 한국 시간 "11월 25일 오후 3시 10분"', () => {
  expect(formatRequestedAt('2026-11-25T06:10:00.000Z')).toBe('11월 25일 오후 3시 10분');
  expect(formatRequestedAt('2026-11-25T15:00:00.000Z')).toBe('11월 26일 오전 12시'); // 날짜 넘김, 정각은 분 생략
  expect(formatRequestedAt('2026-11-25T03:05:00.000Z')).toBe('11월 25일 낮 12시 5분'.replace('낮', '오후'));
  expect(formatRequestedAt('not a date')).toBe('');
});

test('남은 시간은 올림한 시간, 1시간 미만이면 1시간, 지났으면 null', () => {
  const now = Date.parse('2026-11-25T00:00:00.000Z');
  expect(formatRemaining('2026-11-25T20:10:00.000Z', now)).toBe('21시간 안에 마쳐 주세요');
  expect(formatRemaining('2026-11-25T00:20:00.000Z', now)).toBe('1시간 안에 마쳐 주세요');
  expect(formatRemaining('2026-11-24T23:00:00.000Z', now)).toBeNull();
});
