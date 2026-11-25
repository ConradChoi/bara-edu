import { beforeEach, expect, test, vi } from 'vitest';

let approveResult: string;
const approveApi = vi.fn(async (_id: string) => approveResult);
vi.mock('@/lib/db/enrollment', () => ({ approveEnrollmentApi: (id: string) => approveApi(id), applyEnrollment: vi.fn() }));
const requireAdminClient = vi.fn(async () => ({}));
vi.mock('@/lib/supabase/require-admin', () => ({ requireAdminClient: () => requireAdminClient() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { approveEnrollment } from '@/app/actions/admin-enrollments';

const run = () => approveEnrollment('e1').then(() => 'no redirect', (e: Error) => e.message);

beforeEach(() => {
  approveApi.mockClear();
  requireAdminClient.mockClear();
  approveResult = 'ok';
});

test('승인: 관리자 확인 후 API 한 번, 성공이면 success=approved', async () => {
  expect(await run()).toBe('REDIRECT:/admin/enrollments?success=approved');
  expect(requireAdminClient).toHaveBeenCalledTimes(1);
  expect(approveApi).toHaveBeenCalledWith('e1');
});

test('정원이 찼으면 error=course-full', async () => {
  approveResult = 'full';
  expect(await run()).toBe('REDIRECT:/admin/enrollments?error=course-full');
});

test('이미 처리됐거나 없는 신청은 already-processed', async () => {
  for (const r of ['already_processed', 'not_found']) {
    approveResult = r;
    expect(await run(), r).toBe('REDIRECT:/admin/enrollments?error=already-processed');
  }
});

test('관리자 아님 → /, 세션 만료 → /sign-in, 그 밖의 실패 → error=failed', async () => {
  approveResult = 'forbidden';
  expect(await run()).toBe('REDIRECT:/');
  approveResult = 'unauthenticated';
  expect(await run()).toBe('REDIRECT:/sign-in');
  approveResult = 'failed';
  expect(await run()).toBe('REDIRECT:/admin/enrollments?error=failed');
});
