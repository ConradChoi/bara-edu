'use server';

import { redirect } from 'next/navigation';
import { adminConfirmEmail, adminSendReset } from '@/lib/db/auth';
import { getSiteOrigin } from '@/lib/site-origin';
import { logAdminAccess } from '@/lib/supabase/admin-queries';
import { requireAdminClient } from '@/lib/supabase/require-admin';

// 회원이 가입 인증 메일을 못 받았거나 잃어버린 경우, 관리자가 직접 인증 완료 처리를 하고
// 비밀번호 재설정 메일을 보내줄 수 있어야 한다는 요청(2026-10-02). "임시비밀번호를 문자열로
// 발급해 관리자가 직접 전달"하는 방식도 검토했으나, 이 프로젝트에 이메일 발송 인프라가 없어
// (당시 모든 메일은 Supabase Auth 자체 템플릿으로만 나갔다) 새 인프라 없이 쓸 수 있는
// 기존 "비밀번호 재설정" 메일 발송으로 대체하기로 확정(대표 결정, 지금은 API가 SES로 보낸다).
// 회원은 그 메일의 링크를 눌러 새 비밀번호를 직접 설정한 뒤 바로 로그인할 수 있다 — 기존 /reset-password 화면을
// 그대로 재사용하므로 신규 화면이 필요 없다.

export async function confirmMemberEmail(memberId: string) {
  const supabase = await requireAdminClient();
  const { data: member } = await supabase.from('profiles').select('email').eq('id', memberId).maybeSingle();
  if (!member?.email) redirect(`/admin/members/${memberId}?error=failed`);

  // API 연결 실패로 예외가 나도 액션 전체가 죽지 않고 기존 실패 배너로 끝낸다(withdraw()와 동일).
  const confirmed = await adminConfirmEmail(memberId).catch(() => ({ ok: false, reason: 'failed' }) as const);
  if (!confirmed.ok) redirect(`/admin/members/${memberId}?error=${confirmed.reason === 'password_not_set' ? 'password_not_set' : 'failed'}`);

  await logAdminAccess(supabase, memberId, '수정', '이메일 인증 수동 완료 처리');
  redirect(`/admin/members/${memberId}?success=email-confirmed`);
}

export async function sendPasswordResetEmail(memberId: string) {
  const supabase = await requireAdminClient();
  const { data: member } = await supabase.from('profiles').select('email').eq('id', memberId).maybeSingle();
  if (!member?.email) redirect(`/admin/members/${memberId}?error=failed`);

  // 관리자 세션으로 API의 관리자 경로를 부르지만, 메일은 회원 본인 주소로 발송된다
  // (기존 /reset-password 화면이 받는 링크와 동일한 종류).
  const sent = await adminSendReset(memberId, await getSiteOrigin()).catch(() => false);
  if (!sent) redirect(`/admin/members/${memberId}?error=failed`);

  await logAdminAccess(supabase, memberId, '수정', '비밀번호 재설정 메일 발송');
  redirect(`/admin/members/${memberId}?success=reset-email-sent`);
}
