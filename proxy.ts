import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/lib/db/api';
import { clientIpFrom } from '@/lib/db/client-ip';
import { getSession, isDeadSession } from '@/lib/db/auth';

const SESSION_COOKIE = 'bara_session';
const USER_ROUTE_PREFIXES = ['/my', '/learn'];
const ADMIN_ROUTE_PREFIX = '/admin';

function toSignIn(request: NextRequest, withRedirect: boolean): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  if (withRedirect) url.searchParams.set('redirect', request.nextUrl.pathname);
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
    headers: { 'Retry-After': '30', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
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
  return response;
}

// API는 남은 기간이 절반 아래면 세션을 30일로 늘리는데(sliding), 브라우저 쿠키는 로그인 때의 만료일 그대로라
// 브라우저가 먼저 쿠키를 버린다. 쿠키는 만료일을 읽을 수 없으므로 유효한 세션이면 매번 API가 준 expiresAt으로
// 같은 옵션(writeSession과 동일)으로 다시 쓴다 — 한 번 놓쳐도 다음 요청이 바로잡는다.
function withRefreshedCookie(response: NextResponse, token: string, expiresAt: string | undefined): NextResponse {
  const expires = expiresAt ? new Date(expiresAt) : null;
  if (!expires || Number.isNaN(expires.getTime())) return response;
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires,
  });
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
  const r = await getSession(token, clientIp);

  if (isDeadSession(r)) {
    return withoutSessionCookie(request, isProtected ? toSignIn(request, true) : null);
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

  return withRefreshedCookie(NextResponse.next(), token, r.data.expiresAt);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
