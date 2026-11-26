import { beforeEach, expect, test, vi } from 'vitest';

// ---- 로그인 응답 확장(기획서 4.1)과 배포 순서 호환(7.1: 앱 → DB 패치 → API) ----
// 이 앱은 2단계 인증이 없는 지금의 운영 API와도 그대로 돌아야 한다: 응답에 mfa 필드가 없으면 지금과 똑같이 로그인한다.
const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => ({ get: () => null }) }));
vi.mock('@/lib/db/service-key', () => ({ getServiceKey: async () => 'secret-key' }));

import * as auth from '@/lib/db/auth';

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.BARA_API_URL = 'http://api.local';
  store.get.mockReset();
  store.set.mockReset();
  store.delete.mockReset();
});

test('호환: 지금의 운영 API 응답(mfa 필드 없음)은 지금과 똑같이 세션 쿠키만 쓴다', async () => {
  fetchMock.mockResolvedValue(json(200, { sessionToken: 'tok', expiresAt: '2026-12-21T00:00:00.000Z', userId: 'u1' }));
  expect(await auth.login('a@b.kr', 'pw')).toEqual({ ok: true });
  expect(store.set).toHaveBeenCalledTimes(1);
  expect(store.set).toHaveBeenCalledWith('bara_session', 'tok', expect.objectContaining({ httpOnly: true }));
  expect(store.set.mock.calls.some(([n]) => n === 'bara_mfa')).toBe(false);
});

test('관리자(등록됨): mfa=required → 세션 없이 bara_mfa 쿠키만', async () => {
  fetchMock.mockResolvedValue(json(200, { mfa: 'required', challengeToken: 'chal', challengeExpiresAt: new Date(Date.now() + 300_000).toISOString() }));
  expect(await auth.login('a@b.kr', 'pw')).toEqual({ ok: true, mfa: 'required' });
  expect(store.set).toHaveBeenCalledTimes(1);
  const [name, value, opts] = store.set.mock.calls[0];
  expect([name, value]).toEqual(['bara_mfa', 'chal']);
  expect(opts).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
  expect(opts.maxAge).toBeGreaterThan(290);
  expect(opts.maxAge).toBeLessThanOrEqual(300);
});

test('관리자(등록 필요): enroll_required + enrollReason(reset/first, 모르는 값은 first)', async () => {
  for (const [given, want] of [['reset', 'reset'], ['first', 'first'], [undefined, 'first'], ['weird', 'first']] as const) {
    store.set.mockReset();
    fetchMock.mockResolvedValueOnce(json(200, { mfa: 'enroll_required', challengeToken: 'chal', challengeExpiresAt: '2026-11-26T05:15:00.000Z', enrollReason: given }));
    expect(await auth.login('a@b.kr', 'pw')).toEqual({ ok: true, mfa: 'enroll_required', enrollReason: want });
    expect(store.set.mock.calls[0][0]).toBe('bara_mfa');
  }
});

test('모양이 깨진 200(대기표 없는 mfa, 세션도 대기표도 없음)은 실패 — 쿠키 없음', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { mfa: 'required' }));
  expect(await auth.login('a@b.kr', 'pw')).toEqual({ ok: false, reason: 'failed' });
  fetchMock.mockResolvedValueOnce(json(200, {}));
  expect(await auth.login('a@b.kr', 'pw')).toEqual({ ok: false, reason: 'failed' });
  expect(store.set).not.toHaveBeenCalled();
});

test('getSession: adminActivity일 때만 x-bara-activity: admin', async () => {
  fetchMock.mockResolvedValue(json(200, { user: { id: 'u1' }, profile: null }));
  await auth.getSession('tok', '203.0.113.7', { adminActivity: true });
  expect(fetchMock.mock.calls[0][1].headers['x-bara-activity']).toBe('admin');
  await auth.getSession('tok', null);
  expect(fetchMock.mock.calls[1][1].headers['x-bara-activity']).toBeUndefined();
  await auth.getSession('tok', null, { adminActivity: false });
  expect(fetchMock.mock.calls[2][1].headers['x-bara-activity']).toBeUndefined();
});

test('sessionEndedReason: 401 unauthenticated의 reason이 max·idle일 때만', async () => {
  const dead = (body: Record<string, unknown>) => ({ ok: false as const, status: 401, error: { code: 'unauthenticated', message: 'session_expired', ...body } });
  expect(auth.sessionEndedReason(dead({ reason: 'max' }))).toBe('max');
  expect(auth.sessionEndedReason(dead({ reason: 'idle' }))).toBe('idle');
  expect(auth.sessionEndedReason(dead({ reason: 'mfa_required' }))).toBeNull();
  expect(auth.sessionEndedReason(dead({}))).toBeNull();
  expect(auth.sessionEndedReason({ ok: false, status: 401, error: { code: 'unauthorized_service', message: 'x', reason: 'max' } })).toBeNull();
  expect(auth.sessionEndedReason({ ok: true, data: {} })).toBeNull();
});
