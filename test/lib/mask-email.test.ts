import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { maskEmail } from '@/lib/mask-email';

// 대시보드(앱)와 문의·진단 목록(API)의 이메일 가림이 같은 결과를 내는지 같은 표(test/fixtures/mask-email-cases.json)로 본다.
// API 쪽은 api/test/mask-email-cases.test.ts가 같은 표를 읽는다(앱 빌드가 API 코드를 불러오지 않게 표만 공유, 2026-11-27).
const { cases } = JSON.parse(readFileSync('test/fixtures/mask-email-cases.json', 'utf8')) as { cases: [string | null, string][] };

test('공용 표가 비어 있지 않다', () => expect(cases.length).toBeGreaterThan(10));
test.each(cases)('maskEmail(%j) → %j', (input, out) => {
  expect(maskEmail(input)).toBe(out);
});
