'use server';

import { redirect } from 'next/navigation';
import { getApprovedSeatsTaken } from '@/lib/supabase/queries';
import { createClient } from '@/lib/supabase/server';

const PAYMENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // flows.md Q2: 입금 기한 3일

// 신청 확인 화면(/courses/[slug]/apply)에서 "신청 확정" 클릭 시 호출된다.
// 반려/만료(입금기한초과) 건은 기존 행을 pending으로 되돌려 재신청(Q2)한다.
export async function applyToCourse(courseId: string, slug: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?redirect=/courses/${slug}`);

  // /courses/[slug]/apply는 (public) 그룹이라 proxy.ts의 탈퇴 계정 강제 로그아웃 검사
  // (USER_ROUTE_PREFIXES: /my, /learn만 해당) 대상이 아니다 — 탈퇴 처리 직후에도 아직
  // 만료되지 않은 세션이 남아있다면 이 액션에 도달할 수 있어 별도로 방어한다
  // (security-officer 점검, 2026-08-08).
  const { data: profile } = await supabase.from('profiles').select('status').eq('id', user.id).maybeSingle();
  if (profile?.status !== 'active') redirect('/sign-in');

  if (formData.get('agree') !== 'on') {
    redirect(`/courses/${slug}/apply?error=agree-required`);
  }

  const { data: existing } = await supabase
    .from('enrollments')
    .select('id, status, payment_due_at')
    .eq('user_id', user.id)
    .eq('course_id', courseId)
    .maybeSingle();

  const isOverdue = existing?.status === 'pending' && new Date(existing.payment_due_at) < new Date();
  const isActive = existing && (existing.status === 'approved' || (existing.status === 'pending' && !isOverdue));

  if (isActive) {
    redirect(`/courses/${slug}`);
  }

  // apply 페이지는 렌더링 시점에만 정원마감/강좌상태를 확인한다 — 그 사이 정원이 차거나
  // 관리자가 강좌를 closed로 바꿔도 이 액션 자체는 재검증하지 않아 그대로 커밋될 수 있었다
  // (design.md 5절 "정원 마감 후 신청 시도 → 서버에서 재검증 후 거부" 요구사항 위반,
  // qa-reviewer 점검, 2026-08-09). 커밋 직전에 다시 확인한다.
  const { data: course } = await supabase.from('courses').select('status, seats').eq('id', courseId).maybeSingle();
  if (!course || !['active', 'upcoming'].includes(course.status)) {
    redirect(`/courses/${slug}`);
  }
  const seatsTaken = await getApprovedSeatsTaken([courseId]);
  if ((seatsTaken[courseId] ?? 0) >= course.seats) {
    redirect(`/courses/${slug}`);
  }

  const paymentDueAt = new Date(Date.now() + PAYMENT_WINDOW_MS).toISOString();

  // 이 커밋도 다른 상태 전이 액션들(admin-enrollments.ts 등)과 동일하게 에러/경쟁 여부를
  // 명시적으로 확인한다 — 이전에는 결과를 버리고 무조건 성공 화면으로 보내, 더블클릭 등으로
  // update가 0행에 적용되거나 insert가 unique 제약에 걸려도 "신청 성공"처럼 보였다
  // (qa-reviewer 점검, 2026-08-09).
  if (existing) {
    const { data: updated, error } = await supabase
      .from('enrollments')
      .update({
        status: 'pending',
        payment_due_at: paymentDueAt,
        created_at: new Date().toISOString(),
        rejection_reason: null,
      })
      .eq('id', existing.id)
      .eq('status', existing.status)
      .select('id');
    if (error || !updated || updated.length === 0) {
      redirect(`/courses/${slug}/apply?error=conflict`);
    }
  } else {
    const { error } = await supabase
      .from('enrollments')
      .insert({ user_id: user.id, course_id: courseId, payment_due_at: paymentDueAt });
    if (error) {
      redirect(`/courses/${slug}/apply?error=conflict`);
    }
  }

  redirect(`/courses/${slug}`);
}
