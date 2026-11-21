import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { verifyEmail } from '@/lib/db/auth';

// 가입 인증 메일 링크. 성공하면 verifyEmail이 세션 쿠키를 쓰고, redirect 응답에 함께 실린다.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const ok = token ? await verifyEmail(token) : false;
  redirect(ok ? '/my?welcome=1' : '/sign-in?confirmError=1');
}
