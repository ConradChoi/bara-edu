import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Admin 서버 액션은 지금까지 로그인 여부조차 확인하지 않고 RLS(is_admin())와
// proxy.ts 미들웨어(경로 기반 /admin 차단)에만 의존하고 있었다 — module-lms-5의
// classroom.ts(assertClassroomWriteAccess)가 "페이지가 이미 확인했어도 서버 액션은
// 직접 호출될 수 있다"는 이유로 앱 레벨 재검증을 도입한 것과 같은 이유로, 더 높은
// 권한을 다루는 admin 액션에도 동일하게 적용한다(security-officer 통합 점검, 2026-08-09
// — 지금 당장 뚫리는 건 아니지만, RLS 하나에만 의존하는 단일 장애점을 없앤다).
// admin-*.ts의 모든 액션이 기존 `createClient()` 호출을 이걸로 교체해 재사용한다.
export async function requireAdminClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'admin') redirect('/');

  return supabase;
}
