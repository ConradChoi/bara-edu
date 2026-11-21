import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/lib/db/api';
import { getSession } from '@/lib/db/auth';

const SESSION_COOKIE = 'bara_session';
const USER_ROUTE_PREFIXES = ['/my', '/learn'];
const ADMIN_ROUTE_PREFIX = '/admin';

function toSignIn(request: NextRequest, withRedirect: boolean): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  if (withRedirect) url.searchParams.set('redirect', request.nextUrl.pathname);
  return NextResponse.redirect(url);
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

// Next.js 16부터 middleware.ts가 proxy.ts로 이름이 바뀌었다 (기능은 동일, Node.js 런타임).
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isAdminRoute = pathname.startsWith(ADMIN_ROUTE_PREFIX);
  const isProtected = isAdminRoute || USER_ROUTE_PREFIXES.some((p) => pathname.startsWith(p));

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return isProtected ? toSignIn(request, true) : NextResponse.next();

  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const r = await getSession(token, clientIp);

  if (!r.ok && r.status === 401) {
    return withoutSessionCookie(request, isProtected ? toSignIn(request, true) : null);
  }
  if (!r.ok) {
    if (!isProtected) return NextResponse.next();
    return new NextResponse('서비스에 일시적으로 연결할 수 없어요.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
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

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
