'use server';

import { redirect } from 'next/navigation';
import { requireAdminClient } from '@/lib/supabase/require-admin';

// 수료 관리 (F-ADMCE-1~3). certificates에는 unique(user_id, course_id)가 있어
// "재발급"은 새 행을 만드는 게 아니라 기존 행을 갱신하는 것으로 구현한다(admin_delete
// 정책도 없음 — 이 코드베이스에는 파일 재생성 파이프라인이 없어 issued_at만 다시 찍는다).

export async function issueCertificate(userId: string, courseId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.from('certificates').insert({ user_id: userId, course_id: courseId });

  if (error) {
    if (error.code === '23505') redirect('/admin/certificates?error=already-issued');
    redirect('/admin/certificates?error=failed');
  }
  redirect('/admin/certificates?success=issued');
}

export async function reissueCertificate(certificateId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase
    .from('certificates')
    .update({ issued_at: new Date().toISOString() })
    .eq('id', certificateId);

  if (error) redirect('/admin/certificates?error=failed');
  redirect('/admin/certificates?success=reissued');
}

// 대상 회원/강좌를 폼 제출 시점에 <select>로 고르므로(사전 바인딩 불가), formData에서
// 직접 읽는다 — 다른 admin-*.ts 액션들과 달리 courseId/userId를 .bind()로 넘기지 않는다.
export async function manualIssueCertificate(formData: FormData) {
  const userId = formData.get('userId') as string | null;
  const courseId = formData.get('courseId') as string | null;
  const note = (formData.get('note') as string | null)?.trim();

  if (!userId || !courseId || !note) redirect('/admin/certificates?error=note-required');

  const supabase = await requireAdminClient();
  const { error } = await supabase
    .from('certificates')
    .insert({ user_id: userId, course_id: courseId, is_manual_override: true, note });

  if (error) {
    if (error.code === '23505') redirect('/admin/certificates?error=already-issued');
    redirect('/admin/certificates?error=failed');
  }
  redirect('/admin/certificates?success=issued&manual=1');
}
