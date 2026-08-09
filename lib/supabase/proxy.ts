import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const USER_ROUTE_PREFIXES = ['/my', '/learn'];
const ADMIN_ROUTE_PREFIX = '/admin';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 세션 갱신은 항상 수행 (getUser()가 필요 시 토큰을 refresh한다)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isUserRoute = USER_ROUTE_PREFIXES.some((p) => pathname.startsWith(p));
  const isAdminRoute = pathname.startsWith(ADMIN_ROUTE_PREFIX);

  if (!user && (isUserRoute || isAdminRoute)) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  if (user && (isUserRoute || isAdminRoute)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, status')
      .eq('id', user.id)
      .single();

    // 탈퇴 계정 세션 차단 (design.md middleware 요구사항)
    if (profile?.status === 'withdrawn') {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = '/sign-in';
      return NextResponse.redirect(url);
    }

    // role≠admin → (admin) 차단
    if (isAdminRoute && profile?.role !== 'admin') {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return response;
}
