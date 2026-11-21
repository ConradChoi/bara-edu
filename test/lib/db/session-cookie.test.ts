import { beforeEach, expect, test, vi } from 'vitest';

const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({ cookies: async () => store }));

import { clearSession, readSession, writeSession } from '@/lib/db/session-cookie';

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
