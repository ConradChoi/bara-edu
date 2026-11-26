import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch, isPrefetchRequest } from '@/lib/db/api';
import { clientIpFrom } from '@/lib/db/client-ip';
import { getSession, isDeadSession, sessionEndedReason } from '@/lib/db/auth';

const SESSION_COOKIE = 'bara_session';
const USER_ROUTE_PREFIXES = ['/my', '/learn'];
const ADMIN_ROUTE_PREFIX = '/admin';
// 세션 쿠키를 쓰거나 지우는 응답은 공유 캐시(CDN)에 저장되면 다른 방문자에게 쿠키가 나갈 수 있다 — 항상 private, no-store.
const NO_STORE = 'private, no-store';

// ended: 관리자 세션이 12시간(max)·1시간 미사용(idle)으로 끝났을 때만. 로그인 화면이 이유별 안내를 고른다(기획서 4.9, 1.3 D3).
function toSignIn(request: NextRequest, withRedirect: boolean, ended: 'max' | 'idle' | null = null): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  if (withRedirect) url.searchParams.set('redirect', request.nextUrl.pathname);
  if (ended) url.searchParams.set('ended', ended);
  return NextResponse.redirect(url);
}

// API에 닿지 못한 보호 경로 요청: 평문 대신 /service-unavailable 화면으로 rewrite하고 상태는 503을 유지한다.
// 주소창은 원래 주소(/my 등)라 새로고침이 곧 재시도다. 세션 쿠키는 건드리지 않는다 — 연결 불가는 세션 만료가 아니다.
// 정적 화면이라 API를 다시 부르지 않는다(app/service-unavailable). Retry-After는 backend와 협의 전 초안값 30초.
function toServiceUnavailable(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/service-unavailable';
  url.search = '';
  return NextResponse.rewrite(url, {
    status: 503,
    headers: { 'Retry-After': '30', 'Cache-Control': NO_STORE, 'X-Robots-Tag': 'noindex' },
  });
}

// forwards the request without the cookie too, so pages rendered after this don't look it up again
function withoutSessionCookie(request: NextRequest, redirectTo: NextResponse | null): NextResponse {
  request.cookies.delete(SESSION_COOKIE);
  const response = redirectTo ?? NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(0),
  });
  response.headers.set('Cache-Control', NO_STORE);
  return response;
}

// API는 남은 기간이 절반 아래가 되면 세션을 30일로 늘리는데(sliding), 브라우저 쿠키는 로그인 때의 만료일 그대로라
// 브라우저가 먼저 쿠키를 버린다. API가 "이번 요청에서 실제로 연장했다"(renewed)고 알려 줄 때만 expiresAt으로
// 같은 옵션(writeSession과 동일)으로 다시 쓴다 — 그 밖의 응답(공개 페이지 포함)에는 토큰이 실리지 않는다.
function withRefreshedCookie(response: NextResponse, token: string, expiresAt: string | undefined, renewed: boolean | undefined): NextResponse {
  if (renewed !== true) return response;
  const expires = expiresAt ? new Date(expiresAt) : null;
  if (!expires || Number.isNaN(expires.getTime())) return response;
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires,
  });
  response.headers.set('Cache-Control', NO_STORE);
  return response;
}

// Next.js 16부터 middleware.ts가 proxy.ts로 이름이 바뀌었다 (기능은 동일, Node.js 런타임).
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isAdminRoute = pathname.startsWith(ADMIN_ROUTE_PREFIX);
  const isProtected = isAdminRoute || USER_ROUTE_PREFIXES.some((p) => pathname.startsWith(p));

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return isProtected ? toSignIn(request, true) : NextResponse.next();

  const clientIp = clientIpFrom((n) => request.headers.get(n));
  // 관리자 1시간 미사용 판정의 "사용"은 관리자 화면 요청뿐이다. 프리페치는 사람이 연 화면이 아니므로 붙이지 않는다(기획서 2.3, 보안 점검 M-1).
  const adminActivity = isAdminRoute && !isPrefetchRequest((n) => request.headers.get(n));
  const r = await getSession(token, clientIp, { adminActivity });

  if (isDeadSession(r)) {
    return withoutSessionCookie(request, isProtected ? toSignIn(request, true, sessionEndedReason(r)) : null);
  }
  if (!r.ok) {
    if (!isProtected) return NextResponse.next();
    return toServiceUnavailable(request);
  }

  const profile = r.data.profile;
  // 탈퇴 계정 세션 차단 (design.md middleware 요구사항)
  if (profile?.status === 'withdrawn') {
    await apiFetch('/v1/auth/logout', { method: 'POST', session: token, clientIp });
    return withoutSessionCookie(request, isProtected ? toSignIn(request, false) : null);
  }

  // role≠admin → (admin) 차단
  if (isAdminRoute && profile?.role !== 'admin') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return withRefreshedCookie(NextResponse.next(), token, r.data.expiresAt, r.data.renewed);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
