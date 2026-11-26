import { beforeEach, expect, test, vi } from 'vitest';

const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({ cookies: async () => store }));

import { clearMfaChallenge, clearSession, mfaCookieMaxAge, readMfaChallenge, readSession, writeMfaChallenge, writeSession } from '@/lib/db/session-cookie';

beforeEach(() => {
  store.get.mockReset();
  store.set.mockReset();
  store.delete.mockReset();
});

test('readSession', async () => {
  store.get.mockReturnValue({ value: 't' });
  expect(await readSession()).toBe('t');
  store.get.mockReturnValue(undefined);
  expect(await readSession()).toBeNull();
});

test('writeSession은 요구된 쿠키 속성을 쓴다', async () => {
  await writeSession('t', '2026-12-01T00:00:00.000Z');
  expect(store.set).toHaveBeenCalledWith('bara_session', 't', {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    expires: new Date('2026-12-01T00:00:00.000Z'),
  });
});

test('RSC에서 쓰기·삭제가 던져도 무시한다', async () => {
  store.set.mockImplementation(() => {
    throw new Error('rsc');
  });
  store.delete.mockImplementation(() => {
    throw new Error('rsc');
  });
  await expect(writeSession('t', '2026-12-01T00:00:00.000Z')).resolves.toBeUndefined();
  await expect(clearSession()).resolves.toBeUndefined();
});

// ---- 2단계 대기표 쿠키 bara_mfa (기획서 2.2·4.10): httpOnly(스크립트가 못 읽음), lax, path=/, Max-Age=남은 시간 ----

test('writeMfaChallenge: httpOnly·lax·path=/·maxAge=대기표 남은 초 (운영은 secure)', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-26T05:00:00.000Z'));
  try {
    await writeMfaChallenge('chal', '2026-11-26T05:05:00.000Z');
    expect(store.set).toHaveBeenCalledWith('bara_mfa', 'chal', { httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 300 });
    vi.stubEnv('NODE_ENV', 'production');
    await writeMfaChallenge('chal', '2026-11-26T05:15:00.000Z');
    expect(store.set).toHaveBeenLastCalledWith('bara_mfa', 'chal', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 900 });
  } finally {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  }
});

test('mfaCookieMaxAge: 형식 오류는 5분, 지난 시각은 1초, 15분을 넘지 않는다', () => {
  const now = Date.parse('2026-11-26T05:00:00.000Z');
  expect(mfaCookieMaxAge('', now)).toBe(300);
  expect(mfaCookieMaxAge('2026-11-26T04:00:00.000Z', now)).toBe(1);
  expect(mfaCookieMaxAge('2026-11-27T05:00:00.000Z', now)).toBe(900);
});

test('readMfaChallenge·clearMfaChallenge', async () => {
  store.get.mockImplementation((n: string) => (n === 'bara_mfa' ? { value: 'chal' } : undefined));
  expect(await readMfaChallenge()).toBe('chal');
  store.get.mockReturnValue(undefined);
  store.get.mockImplementation(() => undefined);
  expect(await readMfaChallenge()).toBeNull();
  await clearMfaChallenge();
  expect(store.delete).toHaveBeenCalledWith('bara_mfa');
  store.delete.mockImplementation(() => {
    throw new Error('rsc');
  });
  await expect(clearMfaChallenge()).resolves.toBeUndefined();
});
