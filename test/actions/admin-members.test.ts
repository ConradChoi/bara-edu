import { beforeEach, expect, test, vi } from 'vitest';

const ADMIN = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
type Init = { method?: string; body?: Record<string, unknown>; session?: string | null };
type Res = { ok: true; data: unknown } | { ok: false; status: number; error: { code: string; message: string } };

const calls: { path: string; init: Init }[] = [];
const overrides = new Map<string, Res>();
const ok = (data: unknown): Res => ({ ok: true, data });
const day = 24 * 60 * 60 * 1000;

const apiFetch = vi.fn(async (path: string, init: Init): Promise<Res> => {
  calls.push({ path, init });
  const o = overrides.get(path);
  if (o) return o;
  if (path === '/v1/auth/session') return ok({ user: { id: ADMIN, email: 'admin@bara-edu.kr', emailConfirmedAt: null }, profile: null });
  if (path === '/v1/query') {
    const { table, select } = init.body as { table: string; select: string };
    if (table === 'profiles' && select === 'role') return ok({ data: { role: 'admin' } });
    if (table === 'profiles' && select === 'email') return ok({ data: { email: 'm@b.kr' } });
    if (table === 'profiles') {
      return ok({
        data: [
          { id: 'a', created_at: new Date(Date.now() - 10 * day).toISOString() },
          { id: 'b', created_at: new Date().toISOString() },
          { id: 'c', created_at: new Date(Date.now() - 10 * day).toISOString() },
          { id: 'missing', created_at: new Date(Date.now() - 10 * day).toISOString() },
        ],
      });
    }
    return ok({ data: null });
  }
  return ok({ ok: true, mailSent: true });
});
vi.mock('@/lib/db/api', () => ({ apiFetch: (path: string, init: Init) => apiFetch(path, init) }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'admin-tok' }), set: vi.fn(), delete: vi.fn() }),
  headers: async () => ({ get: (k: string) => (k === 'host' ? 'bara-edu.kr' : null) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { confirmMemberEmail, sendPasswordResetEmail } from '@/app/actions/admin-members';
import { getUnconfirmedMemberStats } from '@/lib/supabase/admin-queries';

const run = (p: Promise<unknown>) => p.then(() => 'no redirect', (e: Error) => e.message);
const to = (path: string) => calls.filter((c) => c.path === path);

beforeEach(() => {
  calls.length = 0;
  overrides.clear();
});

test('인증 완료 처리: confirm-email 경로를 관리자 세션으로 부른다', async () => {
  expect(await run(confirmMemberEmail(MEMBER))).toBe(`REDIRECT:/admin/members/${MEMBER}?success=email-confirmed`);
  expect(to(`/v1/admin/users/${MEMBER}/confirm-email`)[0].init).toMatchObject({ method: 'POST', session: 'admin-tok' });
});

test('인증 완료 처리 실패 → 기존 실패 문구', async () => {
  overrides.set(`/v1/admin/users/${MEMBER}/confirm-email`, { ok: false, status: 404, error: { code: 'not_found', message: 'x' } });
  expect(await run(confirmMemberEmail(MEMBER))).toBe(`REDIRECT:/admin/members/${MEMBER}?error=failed`);
});

test('재설정 메일: send-reset에 요청 origin을 보낸다', async () => {
  expect(await run(sendPasswordResetEmail(MEMBER))).toBe(`REDIRECT:/admin/members/${MEMBER}?success=reset-email-sent`);
  expect(to(`/v1/admin/users/${MEMBER}/send-reset`)[0].init).toMatchObject({
    method: 'POST',
    session: 'admin-tok',
    body: { origin: 'https://bara-edu.kr' },
  });
});

test('재설정 메일: mailSent:false 또는 실패 응답 → 기존 실패 문구', async () => {
  overrides.set(`/v1/admin/users/${MEMBER}/send-reset`, ok({ ok: true, mailSent: false }));
  expect(await run(sendPasswordResetEmail(MEMBER))).toBe(`REDIRECT:/admin/members/${MEMBER}?error=failed`);
  overrides.set(`/v1/admin/users/${MEMBER}/send-reset`, { ok: false, status: 500, error: { code: 'internal', message: 'x' } });
  expect(await run(sendPasswordResetEmail(MEMBER))).toBe(`REDIRECT:/admin/members/${MEMBER}?error=failed`);
});

test('인증 상태: confirmations 실패 시 캐시하지 않고, 성공 시 한 번 호출로 집계한 뒤 캐시한다', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  overrides.set('/v1/admin/users/confirmations', { ok: false, status: 500, error: { code: 'internal', message: 'x' } });
  expect(await getUnconfirmedMemberStats()).toEqual({ total: 0, staleOver7Days: 0 });
  err.mockRestore();

  overrides.set(
    '/v1/admin/users/confirmations',
    ok({
      items: [
        { id: 'a', emailConfirmedAt: null },
        { id: 'b', emailConfirmedAt: null },
        { id: 'c', emailConfirmedAt: '2026-11-01T00:00:00.000Z' },
      ],
    }),
  );
  expect(await getUnconfirmedMemberStats()).toEqual({ total: 2, staleOver7Days: 1 });
  expect(await getUnconfirmedMemberStats()).toEqual({ total: 2, staleOver7Days: 1 });
  const confirmations = to('/v1/admin/users/confirmations');
  expect(confirmations).toHaveLength(2);
  expect(confirmations[1].init).toMatchObject({ method: 'GET', session: 'admin-tok' });
});
