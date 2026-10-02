'use server';

import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAdminAccess } from '@/lib/supabase/admin-queries';
import { requireAdminClient } from '@/lib/supabase/require-admin';

// 회원이 가입 인증 메일을 못 받았거나 잃어버린 경우, 관리자가 직접 인증 완료 처리를 하고
// 비밀번호 재설정 메일을 보내줄 수 있어야 한다는 요청(2026-10-02). "임시비밀번호를 문자열로
// 발급해 관리자가 직접 전달"하는 방식도 검토했으나, 이 프로젝트에 이메일 발송 인프라가 없어
// (지금까지 모든 메일은 Supabase Auth 자체 템플릿으로만 나갔다) 새 인프라 없이 쓸 수 있는
// 기존 "비밀번호 재설정" 메일 발송으로 대체하기로 확정(대표 결정). 회원은 그 메일의 링크를
// 눌러 새 비밀번호를 직접 설정한 뒤 바로 로그인할 수 있다 — 기존 /reset-password 화면을
// 그대로 재사용하므로 신규 화면이 필요 없다.

export async function confirmMemberEmail(memberId: string) {
  const supabase = await requireAdminClient();
  const { data: member } = await supabase.from('profiles').select('email').eq('id', memberId).maybeSingle();
  if (!member?.email) redirect(`/admin/members/${memberId}?error=failed`);

  // createAdminClient()는 SUPABASE_SERVICE_ROLE_KEY가 없으면 예외를 던진다 — withdraw()에서
  // 겪은 것과 동일한 문제가 여기서도 전체 액션을 죽이지 않도록 try/catch로 안전하게 처리한다.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    console.error('[confirmMemberEmail] admin client unavailable (SUPABASE_SERVICE_ROLE_KEY?):', err);
    redirect(`/admin/members/${memberId}?error=failed`);
  }

  const { error } = await admin.auth.admin.updateUserById(memberId, { email_confirm: true });
  if (error) redirect(`/admin/members/${memberId}?error=failed`);

  await logAdminAccess(supabase, memberId, '수정', '이메일 인증 수동 완료 처리');
  redirect(`/admin/members/${memberId}?success=email-confirmed`);
}

export async function sendPasswordResetEmail(memberId: string) {
  const supabase = await requireAdminClient();
  const { data: member } = await supabase.from('profiles').select('email').eq('id', memberId).maybeSingle();
  if (!member?.email) redirect(`/admin/members/${memberId}?error=failed`);

  // resetPasswordForEmail()은 대상 이메일 하나만으로 동작하는 공개 엔드포인트라, 지금 이
  // supabase 클라이언트가 관리자 자신의 세션을 들고 있어도 무관하게 회원 본인 앞으로
  // 재설정 메일이 발송된다(기존 /reset-password 화면이 받는 링크와 동일한 종류).
  const { error } = await supabase.auth.resetPasswordForEmail(member.email);
  if (error) redirect(`/admin/members/${memberId}?error=failed`);

  await logAdminAccess(supabase, memberId, '수정', '비밀번호 재설정 메일 발송');
  redirect(`/admin/members/${memberId}?success=reset-email-sent`);
}
