import { beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/headers', () => ({
  headers: async () => {
    throw new Error('headers() must not be called in proxy');
  },
  cookies: async () => {
    throw new Error('cookies() must not be called in proxy');
  },
}));
vi.mock('@/lib/db/service-key', () => ({ getServiceKey: async () => 'secret-key' }));

import { proxy } from '@/proxy';

const fetchMock = vi.fn();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const session = (profile: { role: string; status: string } | null) =>
  json(200, { user: { id: 'u1', email: 'a@b.kr', emailConfirmedAt: '2026-11-01T00:00:00+00:00' }, profile });

const request = (path: string, token?: string) =>
  new NextRequest(`https://bara-edu.kr${path}`, {
    headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', ...(token ? { cookie: `bara_session=${token}` } : {}) },
  });
const location = (res: Response) => {
  const l = res.headers.get('location');
  return l ? new URL(l).pathname + new URL(l).search : null;
};
const passedThrough = (res: Response) => res.headers.get('x-middleware-next') === '1';
const cookieDeleted = (res: Response) => /bara_session=;.*Expires=Thu, 01 Jan 1970/i.test(res.headers.get('set-cookie') ?? '');

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.BARA_API_URL = 'http://api.local';
});

test('proxy: 공개 경로는 쿠키 없어도 통과', async () => {
  const res = await proxy(request('/courses'));
  expect(passedThrough(res)).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('proxy: 쿠키 없이 보호 경로 → /sign-in?redirect=', async () => {
  expect(location(await proxy(request('/learn/abc')))).toBe('/sign-in?redirect=%2Flearn%2Fabc');
  expect(location(await proxy(request('/admin/members')))).toBe('/sign-in?redirect=%2Fadmin%2Fmembers');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('proxy: 쿠키의 세션이 401 → 쿠키 삭제 + /my 요청은 /sign-in?redirect=/my', async () => {
  fetchMock.mockResolvedValue(json(401, { error: { code: 'unauthenticated', message: 'x' } }));
  const res = await proxy(request('/my', 'stale'));
  expect(location(res)).toBe('/sign-in?redirect=%2Fmy');
  expect(cookieDeleted(res)).toBe(true);
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe('http://api.local/v1/auth/session');
  expect(init.headers['x-bara-session']).toBe('stale');
  expect(init.headers['x-bara-client-ip']).toBe('203.0.113.7');
});

test('proxy: 공개 경로에서 세션 401 → 쿠키만 지우고 통과', async () => {
  fetchMock.mockResolvedValue(json(401, { error: { code: 'unauthenticated', message: 'x' } }));
  const res = await proxy(request('/', 'stale'));
  expect(passedThrough(res)).toBe(true);
  expect(cookieDeleted(res)).toBe(true);
  expect(res.headers.get('x-middleware-override-headers')).toContain('cookie');
  expect(res.headers.get('x-middleware-request-cookie') ?? '').not.toContain('bara_session');
});

test('proxy: withdrawn → 로그아웃·쿠키 삭제·/sign-in', async () => {
  fetchMock.mockResolvedValueOnce(session({ role: 'user', status: 'withdrawn' }));
  fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
  const res = await proxy(request('/my', 'tok'));
  expect(location(res)).toBe('/sign-in');
  expect(cookieDeleted(res)).toBe(true);
  const [url, init] = fetchMock.mock.calls[1];
  expect(String(url)).toBe('http://api.local/v1/auth/logout');
  expect(init.method).toBe('POST');
  expect(init.headers['x-bara-session']).toBe('tok');
});

test('proxy: 비관리자 /admin → /', async () => {
  fetchMock.mockResolvedValueOnce(session({ role: 'user', status: 'active' }));
  expect(location(await proxy(request('/admin', 'tok')))).toBe('/');
  fetchMock.mockResolvedValueOnce(session(null));
  expect(location(await proxy(request('/admin/courses', 'tok')))).toBe('/');
});

test('proxy: 관리자 /admin, 회원 /my 는 통과', async () => {
  fetchMock.mockResolvedValueOnce(session({ role: 'admin', status: 'active' }));
  expect(passedThrough(await proxy(request('/admin', 'tok')))).toBe(true);
  fetchMock.mockResolvedValueOnce(session({ role: 'user', status: 'active' }));
  const res = await proxy(request('/my', 'tok'));
  expect(passedThrough(res)).toBe(true);
  expect(cookieDeleted(res)).toBe(false);
});

test('proxy: API 503 → 보호 경로는 /sign-in으로 보내지 않고 쿠키도 유지, 공개 경로는 통과', async () => {
  fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
  const res = await proxy(request('/my', 'tok'));
  expect(res.status).toBe(503);
  expect(location(res)).toBeNull();
  expect(cookieDeleted(res)).toBe(false);
  const pub = await proxy(request('/courses', 'tok'));
  expect(passedThrough(pub)).toBe(true);
  expect(cookieDeleted(pub)).toBe(false);
});

test('proxy: 서비스 키 오류(401 unauthorized_service)는 세션 만료가 아니다 — 쿠키 유지, 보호 경로 503, 공개 경로 통과', async () => {
  fetchMock.mockImplementation(async () => json(401, { error: { code: 'unauthorized_service', message: 'x' } }));
  const res = await proxy(request('/my', 'tok'));
  expect(res.status).toBe(503);
  expect(location(res)).toBeNull();
  expect(cookieDeleted(res)).toBe(false);
  const pub = await proxy(request('/', 'tok'));
  expect(passedThrough(pub)).toBe(true);
  expect(cookieDeleted(pub)).toBe(false);
});
