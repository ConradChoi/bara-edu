'use server';

import { redirect } from 'next/navigation';
import { createRevealToken } from '@/lib/supabase/admin-pii-reveal';
import { requireAdminClient } from '@/lib/supabase/require-admin';

// 도형심리 역량진단 관리자 액션(F-ADMDG-*). 목록 화면의 "개인정보 보기"는 그 자리에서
// 값을 복호화/토글하는 게 아니라, 열람 의사를 명시적으로 표시하는 서버 왕복이다.
//
// 이전에는 여기서 바로 logAdminAccess()를 호출하고 revealPii=<id> 쿼리파라미터만으로
// 목록 조회 함수가 마스킹을 해제했는데, id는 마스킹된 화면에도 이미 노출돼 있어 관리자가
// 버튼 없이 주소창에 직접 붙여넣으면 기록 없이 원문이 보이는 문제가 있었다(qa-reviewer +
// privacy-security-officer 공통 지적, 2026-09-14). 이제는 여기서 서명된 단기 토큰만
// 발급하고, 실제 마스킹 해제·접속기록 기록은 둘 다 lib/supabase/admin-queries.ts의 조회
// 함수 안에서 그 토큰을 검증했을 때만 함께 일어난다 — 로그 없이 해제되는 경로 자체를 없앤다.
export async function revealDiagnosisResultContact(resultId: string) {
  const supabase = await requireAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/admin/selfcheck');

  // createRevealToken()은 SUPABASE_SERVICE_ROLE_KEY(HMAC 키)가 없으면 예외를 던진다 —
  // 이 키는 Amplify 환경변수로 별도 등록해야 하는 값이라, 로컬(.env.local)에는 있어도
  // 배포 환경에 빠져 있으면 이 서버 액션 전체가 죽어 "A server error occurred" 크래시
  // 화면으로 이어졌다(2026-09-15 보고). redirect() 자체가 예외 기반이라 try/catch가
  // redirect까지 함께 삼키지 않도록 실패 시에만 잡는다.
  let token: string, exp: number;
  try {
    ({ token, exp } = createRevealToken('diagnosis_result', resultId, user.id));
  } catch (err) {
    console.error('[revealDiagnosisResultContact] token issuance failed:', err);
    redirect('/admin/selfcheck?revealFailed=1');
  }
  redirect(`/admin/selfcheck?revealPii=${resultId}&revealToken=${token}&revealExp=${exp}`);
}

export async function hideDiagnosisResultContact() {
  redirect('/admin/selfcheck');
}

export async function revealDiagnosisLeadContact(leadId: string) {
  const supabase = await requireAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/admin/selfcheck/leads');

  let token: string, exp: number;
  try {
    ({ token, exp } = createRevealToken('diagnosis_lead', leadId, user.id));
  } catch (err) {
    console.error('[revealDiagnosisLeadContact] token issuance failed:', err);
    redirect('/admin/selfcheck/leads?error=reveal-failed');
  }
  redirect(`/admin/selfcheck/leads?revealPii=${leadId}&revealToken=${token}&revealExp=${exp}`);
}

export async function hideDiagnosisLeadContact() {
  redirect('/admin/selfcheck/leads');
}

// 상태 전환은 admin-enrollments.ts와 동일한 "이전 상태 일치" 조건부 update 패턴 —
// 두 관리자가 동시에 처리해도 한쪽만 성공하고 나머지는 "이미 처리됨"으로 안내한다.
export async function markLeadContacted(leadId: string, formData: FormData) {
  const note = (formData.get('note') as string | null)?.trim() || null;
  const supabase = await requireAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('diagnosis_leads')
    .update({ status: 'contacted', handled_by: user?.id, handled_at: new Date().toISOString(), admin_note: note })
    .eq('id', leadId)
    .eq('status', 'new')
    .select();

  if (error) redirect('/admin/selfcheck/leads?error=failed');
  if (!data || data.length === 0) redirect('/admin/selfcheck/leads?error=already-processed');
  redirect('/admin/selfcheck/leads?success=contacted');
}

export async function closeLead(leadId: string, fromStatus: 'new' | 'contacted', formData: FormData) {
  const reason = (formData.get('reason') as string | null)?.trim();
  if (!reason) redirect('/admin/selfcheck/leads?error=reason-required');

  const supabase = await requireAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('diagnosis_leads')
    .update({ status: 'closed', handled_by: user?.id, handled_at: new Date().toISOString(), admin_note: reason })
    .eq('id', leadId)
    .eq('status', fromStatus)
    .select();

  if (error) redirect('/admin/selfcheck/leads?error=failed');
  if (!data || data.length === 0) redirect('/admin/selfcheck/leads?error=already-processed');
  redirect('/admin/selfcheck/leads?success=closed');
}

export async function updateLeadNote(leadId: string, formData: FormData) {
  const note = (formData.get('note') as string | null)?.trim() || null;
  const supabase = await requireAdminClient();
  const { error } = await supabase.from('diagnosis_leads').update({ admin_note: note }).eq('id', leadId);
  if (error) redirect('/admin/selfcheck/leads?error=failed');
  redirect('/admin/selfcheck/leads?success=note-updated');
}
