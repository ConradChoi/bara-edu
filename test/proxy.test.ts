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
    headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 130.176.1.1', ...(token ? { cookie: `bara_session=${token}` } : {}) },
  });
const location = (res: Response) => {
  const l = res.headers.get('location');
  return l ? new URL(l).pathname + new URL(l).search : null;
};
const passedThrough = (res: Response) => res.headers.get('x-middleware-next') === '1';
const setCookie = (res: Response) => res.headers.get('set-cookie') ?? '';
const rewrittenTo = (res: Response) => {
  const l = res.headers.get('x-middleware-rewrite');
  return l ? new URL(l).pathname : null;
};
const cookieDeleted = (res: Response) => /bara_session=;.*Expires=Thu, 01 Jan 1970/i.test(res.headers.get('set-cookie') ?? '');

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.BARA_API_URL = 'http://api.local';
});

test('proxy: /service-unavailable 자체는 보호 경로가 아니라 세션 조회 없이 통과', async () => {
  expect(passedThrough(await proxy(request('/service-unavailable')))).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
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
  expect(rewrittenTo(res)).toBe('/service-unavailable'); // 평문이 아니라 오류 화면으로 rewrite
  expect(res.headers.get('retry-after')).toBe('30');
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('x-robots-tag')).toBe('noindex');
  expect(cookieDeleted(res)).toBe(false);
  expect(setCookie(res)).toBe(''); // 세션 쿠키를 지우지도 다시 쓰지도 않는다
  expect(await proxy(request('/learn/c1/lessons/l1', 'tok'))).toHaveProperty('status', 503);
  expect(rewrittenTo(await proxy(request('/admin/members', 'tok')))).toBe('/service-unavailable');
  const pub = await proxy(request('/courses', 'tok'));
  expect(passedThrough(pub)).toBe(true);
  expect(cookieDeleted(pub)).toBe(false);
});

test('proxy: 서비스 키 오류(401 unauthorized_service)는 세션 만료가 아니다 — 쿠키 유지, 보호 경로 503, 공개 경로 통과', async () => {
  fetchMock.mockImplementation(async () => json(401, { error: { code: 'unauthorized_service', message: 'x' } }));
  const res = await proxy(request('/my', 'tok'));
  expect(res.status).toBe(503);
  expect(rewrittenTo(res)).toBe('/service-unavailable');
  expect(location(res)).toBeNull();
  expect(cookieDeleted(res)).toBe(false);
  const pub = await proxy(request('/', 'tok'));
  expect(passedThrough(pub)).toBe(true);
  expect(cookieDeleted(pub)).toBe(false);
});

test('proxy: 위조된 XFF 맨 앞 값 대신 cloudfront-viewer-address를 API에 넘긴다', async () => {
  fetchMock.mockResolvedValue(session({ role: 'user', status: 'active' }));
  const req = new NextRequest('https://bara-edu.kr/my', {
    headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 130.176.1.1', 'cloudfront-viewer-address': '203.0.113.7:5555', cookie: 'bara_session=t' },
  });
  await proxy(req);
  expect(fetchMock.mock.calls[0][1].headers['x-bara-client-ip']).toBe('203.0.113.7');
});

test('proxy: 유효한 세션이면 API가 준 expiresAt으로 쿠키를 다시 쓴다 (httpOnly, lax, path=/)', async () => {
  fetchMock.mockResolvedValueOnce(
    json(200, {
      user: { id: 'u1', email: 'a@b.kr', emailConfirmedAt: null },
      profile: { role: 'user', status: 'active' },
      expiresAt: '2026-12-25T00:00:00.000Z',
    }),
  );
  const res = await proxy(request('/my', 'tok'));
  expect(passedThrough(res)).toBe(true);
  const c = setCookie(res);
  expect(c).toContain('bara_session=tok');
  expect(c).toMatch(/Expires=Fri, 25 Dec 2026 00:00:00 GMT/i);
  expect(c).toMatch(/HttpOnly/i);
  expect(c).toMatch(/SameSite=lax/i);
  expect(c).toMatch(/Path=\//);
  expect(c).not.toMatch(/Secure/i); // 테스트 환경은 production이 아니다
  expect(cookieDeleted(res)).toBe(false);
});

test('proxy: 공개 경로에서도 유효한 세션이면 쿠키 만료를 갱신한다', async () => {
  fetchMock.mockResolvedValueOnce(
    json(200, { user: { id: 'u1', email: 'a@b.kr', emailConfirmedAt: null }, profile: { role: 'user', status: 'active' }, expiresAt: '2026-12-25T00:00:00.000Z' }),
  );
  const res = await proxy(request('/', 'tok'));
  expect(setCookie(res)).toContain('bara_session=tok');
});

test('proxy: production에서는 Secure 쿠키', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  try {
    fetchMock.mockResolvedValueOnce(
      json(200, { user: { id: 'u1', email: 'a@b.kr', emailConfirmedAt: null }, profile: { role: 'user', status: 'active' }, expiresAt: '2026-12-25T00:00:00.000Z' }),
    );
    expect(setCookie(await proxy(request('/my', 'tok')))).toMatch(/Secure/i);
  } finally {
    vi.unstubAllEnvs();
  }
});

test('proxy: expiresAt이 없거나 잘못된 값이면 쿠키를 건드리지 않는다 (옛 API 응답 호환)', async () => {
  fetchMock.mockResolvedValueOnce(session({ role: 'user', status: 'active' }));
  expect(setCookie(await proxy(request('/my', 'tok')))).toBe('');
  fetchMock.mockResolvedValueOnce(
    json(200, { user: { id: 'u1', email: 'a@b.kr', emailConfirmedAt: null }, profile: null, expiresAt: 'not-a-date' }),
  );
  expect(setCookie(await proxy(request('/my', 'tok')))).toBe('');
});

test('proxy: 세션이 죽었거나 API 장애면 쿠키를 연장하지 않는다', async () => {
  fetchMock.mockRejectedValueOnce(new Error('down'));
  expect(setCookie(await proxy(request('/courses', 'tok')))).toBe('');
});
