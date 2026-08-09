'use server';

import { redirect } from 'next/navigation';
import { requireAdminClient } from '@/lib/supabase/require-admin';

// 과제 검토 (Phase 4.5 — module-lms-5 설계 중 발견한 공백: 원래 콘솔에 이 화면이 없었다).
// /admin/enrollments와 동일하게 조건부 update로 동시 처리를 막는다.

export async function approveAssignment(submissionId: string) {
  const supabase = await requireAdminClient();
  const { data, error } = await supabase
    .from('assignment_submissions')
    .update({ status: 'approved', review_note: null })
    .eq('id', submissionId)
    .eq('status', 'submitted')
    .select();

  if (error) redirect('/admin/assignments?error=failed');
  if (!data || data.length === 0) redirect('/admin/assignments?error=already-processed');
  redirect('/admin/assignments?success=approved');
}

export async function rejectAssignment(submissionId: string, formData: FormData) {
  const reason = (formData.get('reason') as string | null)?.trim();
  if (!reason) redirect('/admin/assignments?error=reason-required');

  const supabase = await requireAdminClient();
  const { data, error } = await supabase
    .from('assignment_submissions')
    .update({ status: 'rejected', review_note: reason })
    .eq('id', submissionId)
    .eq('status', 'submitted')
    .select();

  if (error) redirect('/admin/assignments?error=failed');
  if (!data || data.length === 0) redirect('/admin/assignments?error=already-processed');
  redirect('/admin/assignments?success=rejected');
}
