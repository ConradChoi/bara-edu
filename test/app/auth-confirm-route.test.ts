import { beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const verifyEmail = vi.fn<(t: string) => Promise<boolean>>();
vi.mock('@/lib/db/auth', () => ({ verifyEmail: (t: string) => verifyEmail(t) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { GET } from '@/app/auth/confirm/route';

const get = (qs: string) => GET(new NextRequest(`https://bara-edu.kr/auth/confirm${qs}`)).then(() => 'no redirect', (e: Error) => e.message);

beforeEach(() => verifyEmail.mockReset());

test('토큰 인증 성공 → /my?welcome=1', async () => {
  verifyEmail.mockResolvedValue(true);
  expect(await get('?token=abc')).toBe('REDIRECT:/my?welcome=1');
  expect(verifyEmail).toHaveBeenCalledWith('abc');
});

test('인증 실패(만료·사용됨) → /sign-in?confirmError=1', async () => {
  verifyEmail.mockResolvedValue(false);
  expect(await get('?token=abc')).toBe('REDIRECT:/sign-in?confirmError=1');
});

test('토큰이 없거나 비어 있으면 API 호출 없이 실패 처리', async () => {
  expect(await get('')).toBe('REDIRECT:/sign-in?confirmError=1');
  expect(await get('?token=')).toBe('REDIRECT:/sign-in?confirmError=1');
  expect(verifyEmail).not.toHaveBeenCalled();
});

test('토큰은 URL 디코딩된 값 그대로 전달한다', async () => {
  verifyEmail.mockResolvedValue(true);
  await get('?token=a-b_c%2Bd');
  expect(verifyEmail).toHaveBeenCalledWith('a-b_c+d');
});
