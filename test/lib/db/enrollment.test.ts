import { beforeEach, expect, test, vi } from 'vitest';

type Res = { ok: true; data: unknown } | { ok: false; status: number; error: { code: string; message: string } };
const apiFetch = vi.fn<(p: string, i: { body?: unknown; session?: string | null }) => Promise<Res>>();
vi.mock('@/lib/db/api', () => ({ apiFetch: (p: string, i: never) => apiFetch(p, i) }));
vi.mock('@/lib/db/session-cookie', () => ({ readSession: async () => 'tok' }));

import { applyEnrollment } from '@/lib/db/enrollment';

beforeEach(() => apiFetch.mockReset());

test('오퍼레이션 enrollments.apply를 세션·courseId로 부르고 결과 값을 돌려준다', async () => {
  apiFetch.mockResolvedValue({ ok: true, data: { data: { result: 'full' } } });
  expect(await applyEnrollment('c1')).toBe('full');
  expect(apiFetch).toHaveBeenCalledWith('/v1/op/enrollments.apply', { method: 'POST', session: 'tok', body: { params: { courseId: 'c1' } } });
});

test('401 unauthenticated → unauthenticated, 그 밖의 실패·예외 → failed', async () => {
  apiFetch.mockResolvedValueOnce({ ok: false, status: 401, error: { code: 'unauthenticated', message: 'x' } });
  expect(await applyEnrollment('c1')).toBe('unauthenticated');
  apiFetch.mockResolvedValueOnce({ ok: false, status: 503, error: { code: 'unavailable', message: 'x' } });
  expect(await applyEnrollment('c1')).toBe('failed');
  apiFetch.mockRejectedValueOnce(new Error('down'));
  expect(await applyEnrollment('c1')).toBe('failed');
});
