import { expect, test, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { MFA_COPY, MFA_COPY_PENDING_REVIEW, fill, stepSr } from '@/lib/mfa-copy';
import { graceDaysLeft, isOtp, isTicket, keyGroups, kstLongDate, kstMonthDay, kstWhen, normalizeOtp, pickMfaBanner, spokenCode } from '@/lib/mfa-format';
import { qrSvg } from '@/lib/qr';
import type { MfaStatus } from '@/lib/db/mfa';
import { readFileSync } from 'node:fs';

const NOW = Date.parse('2026-11-26T05:12:00.000Z'); // 서울 오후 2시 12분

test('서울 기준 날짜·시각 표기', () => {
  expect(kstLongDate('2026-11-30T15:30:00.000Z')).toBe('2026년 12월 1일');
  expect(kstMonthDay('2026-12-02T15:00:00.000Z')).toBe('12월 3일');
  expect(kstWhen('2026-11-26T05:12:00.000Z', NOW)).toBe('오늘 오후 2시 12분');
  expect(kstWhen('2026-11-27T05:00:00.000Z', NOW)).toBe('내일 오후 2시');
  expect(kstWhen('2026-11-24T23:05:00.000Z', NOW)).toBe('어제 오전 8시 5분');
  expect(kstWhen('2026-11-20T03:00:00.000Z', NOW)).toBe('11월 20일 오후 12시');
  expect(kstWhen('2025-11-20T15:00:00.000Z', NOW)).toBe('2025년 11월 21일 오전 12시');
  expect(kstWhen(null, NOW)).toBe('-');
  expect(kstLongDate('nope')).toBe('-');
});

test('유예 N = ⌈남은 시간/24시간⌉ (1.3 D8)', () => {
  expect(graceDaysLeft('2026-12-03T00:00:00+09:00', NOW)).toBe(7);
  expect(graceDaysLeft('2026-11-27T00:00:00+09:00', NOW)).toBe(1);
  expect(graceDaysLeft('2026-11-26T00:00:00+09:00', NOW)).toBe(-0);
  expect(graceDaysLeft('2026-11-20T00:00:00+09:00', NOW)).toBeLessThan(0);
  expect(graceDaysLeft(null, NOW)).toBeNull();
  expect(graceDaysLeft('x', NOW)).toBeNull();
});

const base: MfaStatus = {
  mode: 'enforce',
  enrolled: true,
  enrolledAt: null,
  lastUsedAt: null,
  recoveryCodesLeft: 10,
  recoveryCodesAcked: true,
  canSelfEnroll: false,
  graceUntil: null,
  signedInWithRecovery: false,
  sessionExpiresAt: null,
};

test('배너 우선순위(3.7): MODE-OFF → REC-DONE-ZERO → REC-DONE → GRACE → RCNOTSAVED → RCLOW → MODE-OPTIONAL, 한 개만', () => {
  expect(pickMfaBanner({ ...base, mode: 'off', signedInWithRecovery: true, recoveryCodesLeft: 0 }, NOW)).toEqual({ kind: 'mode_off' });
  expect(pickMfaBanner({ ...base, signedInWithRecovery: true, recoveryCodesLeft: 0, recoveryCodesAcked: false }, NOW)).toEqual({ kind: 'recovery_zero' });
  expect(pickMfaBanner({ ...base, signedInWithRecovery: true, recoveryCodesLeft: 2 }, NOW)).toEqual({ kind: 'recovery_used', left: 2 });
  expect(pickMfaBanner({ ...base, mode: 'optional', enrolled: false, canSelfEnroll: true, graceUntil: '2026-12-03T00:00:00+09:00', recoveryCodesLeft: 0 }, NOW)).toEqual({
    kind: 'grace',
    days: 7,
    date: '12월 3일',
  });
  expect(pickMfaBanner({ ...base, mode: 'optional', recoveryCodesAcked: false, recoveryCodesLeft: 2 }, NOW)).toEqual({ kind: 'rc_not_saved' });
  expect(pickMfaBanner({ ...base, mode: 'optional', recoveryCodesLeft: 3 }, NOW)).toEqual({ kind: 'rc_low', left: 3 });
  expect(pickMfaBanner({ ...base, mode: 'optional', graceUntil: '2026-12-03T00:00:00+09:00' }, NOW)).toEqual({ kind: 'mode_optional', date: '12월 3일' });
  expect(pickMfaBanner(base, NOW)).toBeNull();
  expect(pickMfaBanner({ ...base, recoveryCodesLeft: 0 }, NOW)).toBeNull(); // 0개는 RCLOW(1~3)가 아니다
  // 유예 중이라도 등록 코드가 필요한 미등록(canSelfEnroll=false)은 GRACE가 아니다
  expect(pickMfaBanner({ ...base, mode: 'optional', enrolled: false, canSelfEnroll: false }, NOW)).toBeNull();
});

test('입력 정리·형식', () => {
  expect(normalizeOtp(' 123 456 ')).toBe('123456');
  expect(normalizeOtp('123-456')).toBe('123456');
  expect(isOtp('123456')).toBe(true);
  expect(isOtp('12345')).toBe(false);
  expect(isOtp('12345a')).toBe(false);
  expect(isTicket('12345678')).toBe(true);
  expect(isTicket('1234567')).toBe(false);
  expect(keyGroups('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toEqual(['JBSW', 'Y3DP', 'EHPK', '3PXP', 'JBSW', 'Y3DP', 'EHPK', '3PXP']);
  expect(spokenCode('ABCDE-FGHJK')).toBe('A B C D E, F G H J K');
  expect(spokenCode('12345678', 4)).toBe('1 2 3 4, 5 6 7 8');
});

test('문구: 카피 문서의 MFA-* 슬롯과 글자 그대로 같다(문자열 슬롯 전부)', () => {
  const doc = readFileSync('docs/02-design/features/bara-edu-lms.admin-totp-copy.md', 'utf8');
  const rows = new Map<string, string>();
  for (const line of doc.split('\n')) {
    const m = /^\| (MFA-[A-Z0-9-]+) \|(.*)\|\s*$/.exec(line);
    if (m) rows.set(m[1], m[2]);
  }
  let checked = 0;
  for (const [key, value] of Object.entries(MFA_COPY)) {
    if (typeof value !== 'string' || !rows.has(key)) continue;
    // {at}처럼 값 자리는 카피 문서가 예시 값({내일 오후 2시 12분})으로 적은 곳이 있어 자리 표시만 맞춘다
    const blank = (t: string) => t.replace(/\{[^{}]*\}/g, '{}');
    expect(blank(rows.get(key)!), key).toContain(blank(value));
    checked++;
  }
  expect(checked).toBeGreaterThan(150);
  // 화면에 쓰지 않는 말(카피 0장)
  for (const v of [...Object.values(MFA_COPY).flat(), ...Object.values(MFA_COPY_PENDING_REVIEW)].map((x) => JSON.stringify(x))) {
    expect(v).not.toMatch(/OTP|TOTP|시크릿|토큰|MFA/);
  }
  expect(fill(MFA_COPY['MFA-LOGIN-ERR-WRONG'], { n: 3 })).toBe('번호가 맞지 않아요. 앱에 지금 보이는 번호를 입력해 주세요. (3번 더 시도할 수 있어요)');
  expect(stepSr(3, 2, '인증 앱 등록')).toBe('3단계 중 2단계예요. 인증 앱 등록');
  expect(stepSr(4, 1, '앱 준비')).toBe('4단계 중 1단계예요. 앱 준비');
});

test('QR(앱 서버에서 그림): 정사각 격자, path는 격자 안의 사각형만', () => {
  const uri = `otpauth://totp/${encodeURIComponent('바라 평생교육원:admin@bara-edu.kr')}?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=${encodeURIComponent('바라 평생교육원')}&digits=6&period=30&algorithm=SHA1`;
  const q = qrSvg(uri);
  expect(q.size).toBeGreaterThanOrEqual(21);
  expect(q.size).toBeLessThanOrEqual(73); // 버전 14 이하: 208px에서 모듈이 2.8px 이상
  expect((q.size - 17) % 4).toBe(0);
  expect(q.path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
  // 왼쪽 위 위치 찾기 무늬의 첫 줄(7칸 검정)
  expect(q.path.startsWith('M0 0h7v1h-7z')).toBe(true);
  expect(qrSvg(uri)).toEqual(q); // 같은 주소는 같은 그림(새로고침해도 같은 QR)
});
