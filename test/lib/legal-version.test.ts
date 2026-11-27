import { expect, test } from 'vitest';
import { formatConsentPrivacyDoc, formatDocVersion } from '@/lib/legal-version';

test('formatDocVersion: 정수 버전을 v{n}.0으로(정식 오픈 2026-11-27부터 v1.0, 다음 개정 v2.0)', () => {
  expect(formatDocVersion(1)).toBe('v1.0');
  expect(formatDocVersion(2)).toBe('v2.0');
  expect(formatDocVersion(12)).toBe('v12.0');
});

test('formatConsentPrivacyDoc: 오픈 전 동의 기록(버전 10, 11-28 0시 KST 전)은 "오픈 전 v10", 그 밖은 v{n}.0', () => {
  expect(formatConsentPrivacyDoc(10, '2026-11-26T13:30:00.000Z')).toBe('오픈 전 v10');
  expect(formatConsentPrivacyDoc(10, '2026-11-27T14:59:59.000Z')).toBe('오픈 전 v10');
  expect(formatConsentPrivacyDoc(1, '2026-11-27T09:00:00.000Z')).toBe('v1.0');
  // 새 체계가 v10에 닿은 뒤의 기록은 오픈 전으로 보지 않는다
  expect(formatConsentPrivacyDoc(10, '2026-11-27T15:00:00.000Z')).toBe('v10.0');
  expect(formatConsentPrivacyDoc(10, null)).toBe('v10.0');
  expect(formatConsentPrivacyDoc(10, 'not-a-date')).toBe('v10.0');
});
