import { expect, test } from 'vitest';
import { base32Decode, base32Encode, hotp, matchStep, normalizeTotpInput, otpauthUri, stepAt } from '../src/auth/totp.js';

// RFC 6238 부록 B(SHA-1, 시드 "12345678901234567890"). 8자리 값의 끝 6자리 = 6자리 TOTP(같은 절단 값의 mod 10^6).
const SEED = Buffer.from('12345678901234567890');
const VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

test('RFC 6238 SHA-1 테스트 벡터(8자리, 6자리)', () => {
  for (const [t, eight] of VECTORS) {
    expect(hotp(SEED, stepAt(t * 1000), 8)).toBe(eight);
    expect(hotp(SEED, stepAt(t * 1000))).toBe(eight.slice(2));
  }
});

test('RFC 4226 HOTP 벡터(카운터 0~9)', () => {
  const want = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  want.forEach((w, i) => expect(hotp(SEED, i)).toBe(w));
});

test('base32: RFC 4648 벡터(패딩 없음)와 왕복', () => {
  const v: Array<[string, string]> = [['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI']];
  for (const [plain, enc] of v) {
    expect(base32Encode(Buffer.from(plain))).toBe(enc);
    expect(base32Decode(enc).toString()).toBe(plain);
  }
  const secret = Buffer.from('0123456789abcdefghij');
  const b32 = base32Encode(secret);
  expect(b32).toHaveLength(32);
  expect(base32Decode(b32).equals(secret)).toBe(true);
  expect(() => base32Decode('ABC1')).toThrow();
});

test('matchStep: 현재 칸 ±1만 허용하고 맞은 칸 번호를 돌려준다', () => {
  const now = 1_700_000_000_000;
  const t = stepAt(now);
  expect(matchStep(SEED, hotp(SEED, t), now)).toBe(t);
  expect(matchStep(SEED, hotp(SEED, t - 1), now)).toBe(t - 1);
  expect(matchStep(SEED, hotp(SEED, t + 1), now)).toBe(t + 1);
  expect(matchStep(SEED, hotp(SEED, t - 2), now)).toBeNull();
  expect(matchStep(SEED, hotp(SEED, t + 2), now)).toBeNull();
});

test('matchStep: 세 칸이 같은 번호면 가장 큰 칸(재사용 판정은 가장 최근 칸 기준)', () => {
  // 서로 다른 칸이 같은 6자리를 내는 시드는 드물어서, 같은 칸을 비교 대상으로만 확인한다: 루프가 맞은 칸에서 멈추지 않는다
  const now = 1_700_000_000_000;
  const t = stepAt(now);
  let found = 0;
  for (let i = 0; i < 3; i++) if (matchStep(SEED, hotp(SEED, t - 1 + i), now) === t - 1 + i) found++;
  expect(found).toBe(3);
});

test('otpauthUri: 기획서 4.4.2 형식(발급자·계정 이름 인코딩, SHA1·6자리·30초)', () => {
  const u = otpauthUri('a+b@bara-edu.kr', 'ABCDEFGH');
  expect(u).toBe(
    `otpauth://totp/${encodeURIComponent('바라 평생교육원:a+b@bara-edu.kr')}?secret=ABCDEFGH&issuer=${encodeURIComponent('바라 평생교육원')}&digits=6&period=30&algorithm=SHA1`,
  );
});

test('6자리 입력 정규화: 공백·하이픈 제거, 숫자 6개만', () => {
  expect(normalizeTotpInput(' 123 456 ')).toBe('123456');
  expect(normalizeTotpInput('123-456')).toBe('123456');
  for (const bad of ['12345', '1234567', 'abcdef', '12345a', '']) expect(normalizeTotpInput(bad)).toBeNull();
});
