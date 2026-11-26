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
  expect(res.headers.get('cache-control')).toBe('private, no-store');
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

const active = (extra: Record<string, unknown> = {}) =>
  json(200, { user: { id: 'u1', email: 'a@b.kr', emailConfirmedAt: null }, profile: { role: 'user', status: 'active' }, ...extra });
const cacheControl = (res: Response) => res.headers.get('cache-control');

test('proxy: API가 세션을 실제로 연장했을 때(renewed)만 expiresAt으로 쿠키를 다시 쓴다 (httpOnly, lax, path=/)', async () => {
  fetchMock.mockResolvedValueOnce(active({ expiresAt: '2026-12-25T00:00:00.000Z', renewed: true }));
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

test('proxy: renewed가 false이거나 없으면 쿠키를 쓰지 않는다 (공개 페이지 응답에 토큰이 실리지 않는다)', async () => {
  for (const extra of [{ expiresAt: '2026-12-25T00:00:00.000Z', renewed: false }, { expiresAt: '2026-12-25T00:00:00.000Z' }, {}]) {
    fetchMock.mockResolvedValueOnce(active(extra));
    const res = await proxy(request('/', 'tok'));
    expect(passedThrough(res)).toBe(true);
    expect(setCookie(res), JSON.stringify(extra)).toBe('');
    expect(cacheControl(res)).toBeNull();
  }
});

test('proxy: 쿠키를 쓰는 응답(연장·삭제)에는 Cache-Control: private, no-store', async () => {
  // 연장 (next)
  fetchMock.mockResolvedValueOnce(active({ expiresAt: '2026-12-25T00:00:00.000Z', renewed: true }));
  expect(cacheControl(await proxy(request('/courses', 'tok')))).toBe('private, no-store');
  // 삭제: 보호 경로 redirect, 공개 경로 next, 탈퇴 계정
  fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'unauthenticated', message: 'x' } }));
  expect(cacheControl(await proxy(request('/my', 'stale')))).toBe('private, no-store');
  fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'unauthenticated', message: 'x' } }));
  expect(cacheControl(await proxy(request('/', 'stale')))).toBe('private, no-store');
  fetchMock.mockResolvedValueOnce(json(200, { user: { id: 'u1', email: 'a@b.kr', emailConfirmedAt: null }, profile: { role: 'user', status: 'withdrawn' } }));
  fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
  expect(cacheControl(await proxy(request('/my', 'tok')))).toBe('private, no-store');
});

test('proxy: 503 rewrite도 캐시하지 않는다 (private, no-store)', async () => {
  fetchMock.mockRejectedValueOnce(new Error('down'));
  const res = await proxy(request('/my', 'tok'));
  expect(res.status).toBe(503);
  expect(cacheControl(res)).toBe('private, no-store');
  expect(setCookie(res)).toBe('');
});

test('proxy: production에서는 Secure 쿠키', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  try {
    fetchMock.mockResolvedValueOnce(active({ expiresAt: '2026-12-25T00:00:00.000Z', renewed: true }));
    expect(setCookie(await proxy(request('/my', 'tok')))).toMatch(/Secure/i);
  } finally {
    vi.unstubAllEnvs();
  }
});

test('proxy: renewed여도 expiresAt이 없거나 잘못된 값이면 쿠키를 건드리지 않는다', async () => {
  fetchMock.mockResolvedValueOnce(active({ renewed: true }));
  expect(setCookie(await proxy(request('/my', 'tok')))).toBe('');
  fetchMock.mockResolvedValueOnce(active({ renewed: true, expiresAt: 'not-a-date' }));
  expect(setCookie(await proxy(request('/my', 'tok')))).toBe('');
});

test('proxy: API 장애면 쿠키를 연장하지 않는다', async () => {
  fetchMock.mockRejectedValueOnce(new Error('down'));
  expect(setCookie(await proxy(request('/courses', 'tok')))).toBe('');
});

test('proxy: /forgot-password·/reset-password는 공개 경로 — 로그인 전에도, 로그인한 상태에서도 /my로 보내지 않고 통과', async () => {
  for (const path of ['/forgot-password', '/reset-password?token=t1']) {
    expect(passedThrough(await proxy(request(path)))).toBe(true);
    fetchMock.mockResolvedValueOnce(session({ role: 'user', status: 'active' }));
    const res = await proxy(request(path, 'tok'));
    expect(passedThrough(res)).toBe(true);
    expect(location(res)).toBeNull();
    // 관리자도 막지 않는다(대표 결정 2)
    fetchMock.mockResolvedValueOnce(session({ role: 'admin', status: 'active' }));
    expect(passedThrough(await proxy(request(path, 'tok')))).toBe(true);
  }
});

// ---- 관리자 2단계 인증: 미사용 판정의 "사용"(기획서 2.3, 보안 점검 M-1), 자동 로그아웃 이유(4.9) ----
const withHeaders = (path: string, token: string, extra: Record<string, string>) =>
  new NextRequest(`https://bara-edu.kr${path}`, { headers: { cookie: `bara_session=${token}`, ...extra } });

test('proxy: /admin 화면 요청에만 x-bara-activity: admin, 프리페치·회원 화면·공개 화면에는 없음', async () => {
  fetchMock.mockImplementation(async () => session({ role: 'admin', status: 'active' }));
  await proxy(request('/admin/members', 'tok'));
  expect(fetchMock.mock.calls.at(-1)![1].headers['x-bara-activity']).toBe('admin');
  await proxy(withHeaders('/admin/members', 'tok', { rsc: '1' })); // 클라이언트 이동(RSC)도 사람이 연 화면
  expect(fetchMock.mock.calls.at(-1)![1].headers['x-bara-activity']).toBe('admin');
  const prefetches: Record<string, string>[] = [{ 'next-router-prefetch': '1' }, { 'next-router-segment-prefetch': '/_tree' }, { purpose: 'prefetch' }, { 'sec-purpose': 'prefetch;prerender' }];
  for (const h of prefetches) {
    await proxy(withHeaders('/admin/members', 'tok', h));
    expect(fetchMock.mock.calls.at(-1)![1].headers['x-bara-activity'], JSON.stringify(h)).toBeUndefined();
  }
  for (const path of ['/my', '/learn/c1', '/', '/courses', '/sign-in/otp']) {
    await proxy(request(path, 'tok'));
    expect(fetchMock.mock.calls.at(-1)![1].headers['x-bara-activity'], path).toBeUndefined();
  }
});

test('proxy: 관리자 세션 12시간·1시간 만료(401 reason) → /sign-in?redirect=…&ended=max|idle, 그 밖의 401은 지금처럼', async () => {
  for (const reason of ['max', 'idle'] as const) {
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'unauthenticated', message: 'session_expired', reason } }));
    const res = await proxy(request('/admin/members', 'tok'));
    expect(location(res)).toBe(`/sign-in?redirect=%2Fadmin%2Fmembers&ended=${reason}`);
    expect(cookieDeleted(res)).toBe(true);
  }
  fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'unauthenticated', message: 'session_expired', reason: 'mfa_required' } }));
  expect(location(await proxy(request('/admin', 'tok')))).toBe('/sign-in?redirect=%2Fadmin');
  // 공개 경로에서 끝난 세션은 쿠키만 지우고 그대로(이유를 보여 줄 화면이 없다)
  fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'unauthenticated', message: 'session_expired', reason: 'idle' } }));
  const pub = await proxy(request('/', 'tok'));
  expect(passedThrough(pub)).toBe(true);
  expect(cookieDeleted(pub)).toBe(true);
});

test('proxy: /sign-in/otp·/sign-in/recovery·/sign-in/otp-setup은 공개 경로 — 쿠키 없이도, 로그인한 상태에서도 통과', async () => {
  for (const path of ['/sign-in/otp', '/sign-in/recovery', '/sign-in/otp-setup?reason=reset']) {
    expect(passedThrough(await proxy(request(path)))).toBe(true);
    fetchMock.mockResolvedValueOnce(session({ role: 'admin', status: 'active' }));
    const res = await proxy(request(path, 'tok'));
    expect(passedThrough(res)).toBe(true);
    expect(location(res)).toBeNull();
  }
});

test('proxy: /admin/security는 관리자 경로(비로그인 → 로그인, 비관리자 → /)', async () => {
  expect(location(await proxy(request('/admin/security')))).toBe('/sign-in?redirect=%2Fadmin%2Fsecurity');
  fetchMock.mockResolvedValueOnce(session({ role: 'learner', status: 'active' }));
  expect(location(await proxy(request('/admin/security', 'tok')))).toBe('/');
});

test('proxy: 관리자 세션은 renewed가 오지 않아 쿠키를 늘리지 않는다', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { user: { id: 'u1', email: 'a@b.kr', emailConfirmedAt: null }, profile: { role: 'admin', status: 'active' }, expiresAt: '2026-11-27T02:00:00.000Z', renewed: false }));
  expect(setCookie(await proxy(request('/admin', 'tok')))).toBe('');
});
