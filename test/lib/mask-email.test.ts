import { expect, test } from 'vitest';
import { maskEmail as appMask } from '@/lib/mask-email';
import { maskEmail as apiMask } from '../../api/src/ops/admin-diagnosis';

// 대시보드(앱)와 문의·진단 목록(API)의 이메일 가림이 같은 결과를 내는지 같은 표로 본다(2026-11-27 통일).
const CASES: [string | null, string][] = [
  ['secret@example.com', 'se***@example.com'],
  ['ab@x.kr', '***@x.kr'],
  [null, '-'],
  ['', '-'],
  ['  kim@mail.co.kr ', 'ki***@mail.co.kr'],
  ['hong@naver.com 010-1234-5678', '***'],
  ['hong@naver.com,01012345678', '***'],
  ['a@b@c.kr', '***'],
  ['hong@naver.com.01012345678', '***'],
  ['hong@naver', '***'],
  ['@example.com', '***'],
  ['noat', '***'],
  // 한글 도메인은 도메인 자리에 이름 등이 들어갈 수 있어 통째로 가린다(바꾸지 않기로 한 결정, 2026-11-27)
  ['hong@홍길동.kr', '***'],
  ['hong@example.한국', '***'],
];

test.each(CASES)('maskEmail(%j) → %j (앱·API 같음)', (input, out) => {
  expect(appMask(input)).toBe(out);
  expect(apiMask(input)).toBe(out);
});
