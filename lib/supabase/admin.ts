import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// service_role 키는 RLS를 완전히 우회한다. 이 파일은 서버 전용 코드(Server Action)에서만
// import할 것 — 절대 클라이언트 컴포넌트나 NEXT_PUBLIC_* 값으로 노출하지 않는다.
// 회원탈퇴 시 auth.users 이메일 익명화(admin API)처럼 anon 키로는 불가능한 작업에만 사용한다.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았어요. Supabase 대시보드 > Project Settings > API에서 service_role 키를 발급받아 서버 환경변수(.env.local, 절대 NEXT_PUBLIC_ 접두사 금지)에 추가해주세요.'
    );
  }
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
