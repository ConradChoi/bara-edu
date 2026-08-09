'use server';

import { redirect } from 'next/navigation';
import { requireAdminClient } from '@/lib/supabase/require-admin';

// 신청·입금 관리 (F-ADME-1~4, flows.md 3.5)
// 동시성 처리: 버전/락 컬럼이 없어 "이전 상태 일치" 조건부 update로 원자적으로 처리한다.
// 이미 다른 관리자가 처리한 건이면 .select()가 빈 배열을 반환하므로 그걸로 충돌을 감지한다.

export async function approveEnrollment(enrollmentId: string) {
  const supabase = await requireAdminClient();
  const { data, error } = await supabase
    .from('enrollments')
    .update({ status: 'approved', approved_at: new Date().toISOString(), rejection_reason: null })
    .eq('id', enrollmentId)
    .eq('status', 'pending')
    .select();

  if (error) redirect('/admin/enrollments?error=failed');
  if (!data || data.length === 0) redirect('/admin/enrollments?error=already-processed');
  redirect('/admin/enrollments?success=approved');
}

export async function rejectEnrollment(enrollmentId: string, formData: FormData) {
  const reason = (formData.get('reason') as string | null)?.trim();
  if (!reason) redirect('/admin/enrollments?error=reason-required');

  const supabase = await requireAdminClient();
  const { data, error } = await supabase
    .from('enrollments')
    .update({ status: 'rejected', rejection_reason: reason })
    .eq('id', enrollmentId)
    .eq('status', 'pending')
    .select();

  if (error) redirect('/admin/enrollments?error=failed');
  if (!data || data.length === 0) redirect('/admin/enrollments?error=already-processed');
  redirect('/admin/enrollments?success=rejected');
}

// "승인 취소" — flows.md 3.5 예외표에는 있으나 menu-features.md 기능표에는 빠져있던 항목.
// 잘못 승인한 건을 되돌리는 파괴적 액션이라 반려와 동일하게 사유를 필수로 받는다.
export async function unapproveEnrollment(enrollmentId: string, formData: FormData) {
  const reason = (formData.get('reason') as string | null)?.trim();
  if (!reason) redirect('/admin/enrollments?error=reason-required');

  const supabase = await requireAdminClient();
  const { data, error } = await supabase
    .from('enrollments')
    .update({ status: 'rejected', rejection_reason: `[승인 취소] ${reason}`, approved_at: null })
    .eq('id', enrollmentId)
    .eq('status', 'approved')
    .select();

  if (error) redirect('/admin/enrollments?error=failed');
  if (!data || data.length === 0) redirect('/admin/enrollments?error=already-processed');
  redirect('/admin/enrollments?success=unapproved');
}
