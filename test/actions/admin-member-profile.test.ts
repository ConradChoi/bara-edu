import { beforeEach, expect, test, vi } from 'vitest';

const MEMBER = '33333333-3333-4333-8333-333333333333';
type Init = { method?: string; body?: { params: Record<string, unknown> }; session?: string | null; clientIp?: string | null; headers?: Record<string, string> };
type Res = { ok: true; data: unknown } | { ok: false; status: number; error: { code: string; message: string } };

const calls: { path: string; init: Init }[] = [];
let apiResponse: Res = { ok: true, data: { data: { result: 'ok' } } };

// 앱이 호출하는 API만 가짜로 두고, 요청 헤더에서 IP를 읽는 경로(apiFetch)는 실제 코드를 쓴다.
const fetchMock = vi.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
  calls.push({ path: _url, init: { headers: init.headers, body: JSON.parse(init.body) as { params: Record<string, unknown> } } });
  if (apiResponse.ok) return new Response(JSON.stringify(apiResponse.data), { status: 200 });
  return new Response(JSON.stringify({ error: apiResponse.error }), { status: apiResponse.status });
});

vi.stubGlobal('fetch', fetchMock);
vi.stubEnv('BARA_API_URL', 'http://api.test');
vi.mock('@/lib/db/service-key', () => ({ getServiceKey: async () => 'svc-key' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'admin-tok' }) }),
  headers: async () => ({ get: (k: string) => (k === 'cloudfront-viewer-address' ? '203.0.113.7:51234' : null) }),
}));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
const requireAdmin = vi.fn(async () => ({}));
vi.mock('@/lib/supabase/require-admin', () => ({ requireAdminClient: () => requireAdmin() }));
const logAdminAccess = vi.fn();
vi.mock('@/lib/supabase/admin-queries', () => ({ logAdminAccess: (...a: unknown[]) => logAdminAccess(...a) }));

import { loadMemberProfileEdits, updateMemberProfile } from '@/app/actions/admin-members';
import type { ProfileSaveInput } from '@/lib/admin-profile-edit';

const input = (over: Partial<ProfileSaveInput> = {}): ProfileSaveInput => ({
  name: '홍길동',
  phone: '010-1111-2222',
  expected: { name: '홍길순', phone: '010-1111-2222' },
  reason: 'member_request',
  memo: '',
  identityChecked: true,
  ...over,
});
const respond = (data: unknown) => {
  apiResponse = { ok: true, data: { data } };
};
const sent = () => calls[0].init.body!.params;

beforeEach(() => {
  calls.length = 0;
  revalidatePath.mockClear();
  logAdminAccess.mockClear();
  requireAdmin.mockClear();
  apiResponse = { ok: true, data: { data: { result: 'ok' } } };
});

test('성공: 바뀐 칸만 expected와 함께 보내고, IP·세션을 싣고, 상세를 revalidate한다. logAdminAccess는 부르지 않는다', async () => {
  respond({ result: 'ok', changed: ['name'], profile: { name: '홍길동', phone: '010-1111-2222' }, mailQueued: true });
  const out = await updateMemberProfile(MEMBER, input());
  expect(out).toEqual({ status: 'ok', changed: ['name'], profile: { name: '홍길동', phone: '010-1111-2222' }, mailQueued: true });
  expect(calls[0].path).toBe('http://api.test/v1/op/admin.updateMemberProfile');
  expect(calls[0].init.headers?.['x-bara-client-ip']).toBe('203.0.113.7');
  expect(calls[0].init.headers?.['x-bara-session']).toBe('admin-tok');
  expect(sent()).toEqual({ memberId: MEMBER, name: '홍길동', expected: { name: '홍길순' }, reason: 'member_request', memo: null, identityChecked: true });
  expect(revalidatePath).toHaveBeenCalledWith(`/admin/members/${MEMBER}`);
  expect(logAdminAccess).not.toHaveBeenCalled();
});

test('전화를 비우면 phone:null을 보낸다', async () => {
  respond({ result: 'ok', changed: ['phone'], profile: { name: '홍길순', phone: null }, mailQueued: false });
  const out = await updateMemberProfile(MEMBER, input({ name: '홍길순', phone: '  ' }));
  expect(sent()).toMatchObject({ phone: null, expected: { phone: '010-1111-2222' } });
  expect(sent()).not.toHaveProperty('name');
  expect(out).toMatchObject({ status: 'ok', mailQueued: false });
});

test('바뀐 칸이 없으면 API를 부르지 않고 unchanged', async () => {
  expect(await updateMemberProfile(MEMBER, input({ name: '홍길순' }))).toEqual({ status: 'unchanged', profile: { name: '홍길순', phone: '010-1111-2222' } });
  expect(calls).toHaveLength(0);
});

test('본인 확인 체크가 없으면 API를 부르지 않고 validation(verified)', async () => {
  expect(await updateMemberProfile(MEMBER, input({ identityChecked: false }))).toEqual({ status: 'validation', field: 'verified', code: 'not_checked' });
  expect(calls).toHaveLength(0);
});

test('unchanged(서버)는 성공처럼 revalidate', async () => {
  respond({ result: 'unchanged', changed: [], profile: { name: '홍길동', phone: null } });
  expect(await updateMemberProfile(MEMBER, input())).toEqual({ status: 'unchanged', profile: { name: '홍길동', phone: null } });
  expect(revalidatePath).toHaveBeenCalled();
});

test('stale: 현재 값을 돌려주고 revalidate하지 않는다', async () => {
  respond({ result: 'stale', current: { name: '김철수', phone: null } });
  expect(await updateMemberProfile(MEMBER, input())).toEqual({ status: 'stale', current: { name: '김철수', phone: null } });
  expect(revalidatePath).not.toHaveBeenCalled();
});

test.each([
  [{ result: 'validation', field: 'memo', reason: 'memo_has_pii' }, { status: 'validation', field: 'memo', code: 'memo_has_pii' }],
  [{ result: 'validation', field: 'phone', reason: 'phone_masked' }, { status: 'validation', field: 'phone', code: 'phone_masked' }],
  [{ result: 'validation', field: 'identityChecked', reason: 'not_checked' }, { status: 'validation', field: 'verified', code: 'not_checked' }],
  [{ result: 'validation', field: 'expected', reason: 'expected_missing' }, { status: 'failed' }],
  [{ result: 'withdrawn' }, { status: 'locked', why: 'withdrawn' }],
  [{ result: 'not_confirmed' }, { status: 'locked', why: 'not_confirmed' }],
  [{ result: 'target_is_admin' }, { status: 'locked', why: 'target_is_admin' }],
  [{ result: 'no_email' }, { status: 'locked', why: 'no_email' }],
  [{ result: 'not_found' }, { status: 'not_found' }],
  [{ result: 'forbidden' }, { status: 'forbidden' }],
  [{ result: '???' }, { status: 'failed' }],
])('결과 매핑 %j', async (data, expected) => {
  respond(data);
  expect(await updateMemberProfile(MEMBER, input())).toEqual(expected);
  expect(revalidatePath).not.toHaveBeenCalled();
});

test('503 log_failed, 5xx, 세션 만료', async () => {
  apiResponse = { ok: false, status: 503, error: { code: 'unavailable', message: 'log_failed' } };
  expect(await updateMemberProfile(MEMBER, input())).toEqual({ status: 'log_failed' });
  apiResponse = { ok: false, status: 500, error: { code: 'internal', message: 'x' } };
  expect(await updateMemberProfile(MEMBER, input())).toEqual({ status: 'failed' });
  apiResponse = { ok: false, status: 401, error: { code: 'unauthenticated', message: 'x' } };
  await expect(updateMemberProfile(MEMBER, input())).rejects.toThrow('REDIRECT:/sign-in');
});

test('관리자 확인이 먼저 — 비관리자는 API 호출 전에 막힌다', async () => {
  requireAdmin.mockRejectedValueOnce(new Error('REDIRECT:/'));
  await expect(updateMemberProfile(MEMBER, input())).rejects.toThrow('REDIRECT:/');
  expect(calls).toHaveLength(0);
});

test('잘못된 모양의 입력은 API를 부르지 않는다', async () => {
  expect(await updateMemberProfile(MEMBER, { ...input(), reason: 'x' as never })).toEqual({ status: 'failed' });
  expect(calls).toHaveLength(0);
});

test('이력 더 보기: 목록 오퍼레이션만 부른다(조회 기록용 상세 쿼리 없음)', async () => {
  respond({ result: 'ok', items: [{ at: '2026-11-26T05:12:00.000Z', adminName: null, fields: ['name'], reason: 'typo_fix', memo: null }], hasMore: false });
  const r = await loadMemberProfileEdits(MEMBER, 999);
  expect(r).toMatchObject({ ok: true, hasMore: false });
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('http://api.test/v1/op/admin.listMemberProfileEdits');
  expect(sent()).toEqual({ memberId: MEMBER, limit: 50 });
  expect(logAdminAccess).not.toHaveBeenCalled();
});
