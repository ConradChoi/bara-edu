'use server';

import { redirect } from 'next/navigation';
import { getApprovedSeatsTaken } from '@/lib/supabase/queries';
import { createClient } from '@/lib/db/server';
import { applyEnrollment } from '@/lib/db/enrollment';
import { uploadMemberPhoto } from '@/lib/db/storage';

const PHOTO_ERROR = { 'too-large': 'photo-too-large', invalid: 'photo-invalid', failed: 'photo-failed' } as const;

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
  const { data: profile } = await supabase.from('profiles').select('status, address, photo_path').eq('id', user.id).maybeSingle();
  if (profile?.status !== 'active') redirect('/sign-in');

  if (formData.get('agree') !== 'on') {
    redirect(`/courses/${slug}/apply?error=agree-required`);
  }

  // 강좌마다 자격증 발급용 추가정보(주소/사진)가 필요한지가 다르다 — 자격과정이 아닌
  // 보수교육·일반교육은 이 정보가 필요 없다(관리자 요청, 2026-08-29). apply 페이지는
  // 렌더링 시점에만 이 값을 확인하므로, 커밋 직전에도 다시 조회해 관리자가 그 사이
  // 설정을 바꿔도 안전하게 반영되도록 한다 — 이후 정원/상태 재검증에도 이 조회를 재사용한다.
  const { data: course } = await supabase
    .from('courses')
    .select('status, seats, requires_certificate_info')
    .eq('id', courseId)
    .maybeSingle();
  if (!course) redirect(`/courses/${slug}`);

  // 1) 중복 신청·모집 마감·정원 초과는 사진 업로드와 profiles 갱신보다 먼저 확인한다 — 어차피 거절될 신청이 주소·사진만
  //    저장하고 끝나는 일이 없게 한다(2026-11-25). 여기는 빠른 사전 확인이고, 최종 판단은 아래 3)에서 API가 한다.
  const { data: existing } = await supabase
    .from('enrollments')
    .select('id, status, payment_due_at')
    .eq('user_id', user.id)
    .eq('course_id', courseId)
    .maybeSingle();

  const isOverdue = existing?.status === 'pending' && new Date(existing.payment_due_at) < new Date();
  const isActive = existing && (existing.status === 'approved' || (existing.status === 'pending' && !isOverdue));
  if (isActive) redirect(`/courses/${slug}`);

  if (!['active', 'upcoming'].includes(course!.status)) redirect(`/courses/${slug}`);
  const seatsTaken = await getApprovedSeatsTaken([courseId]);
  if ((seatsTaken[courseId] ?? 0) >= course!.seats) redirect(`/courses/${slug}`);

  // 2) 주소/사진은 회원당 1회만 받아 재사용한다(관리자 요청, 2026-08-28) — 이미 등록돼
  // 있으면 이번 신청에서 값을 새로 안 보내도 기존 값을 그대로 쓴다.
  if (course!.requires_certificate_info) {
    const addressInput = (formData.get('address') as string | null)?.trim();
    const finalAddress = addressInput || profile.address;
    if (!finalAddress) redirect(`/courses/${slug}/apply?error=address-required`);

    const photoFile = formData.get('photo') as File | null;
    let photoPath = profile.photo_path;
    if (photoFile && photoFile.size > 0) {
      // 사진 검증(5MB, 실제 매직바이트로 JPEG/PNG/WebP만 — security-officer 점검, 2026-08-28)은
      // uploadMemberPhoto 안에서 업로드 전에 한다.
      const uploaded = await uploadMemberPhoto(photoFile);
      if ('error' in uploaded) redirect(`/courses/${slug}/apply?error=${PHOTO_ERROR[uploaded.error]}`);
      photoPath = uploaded.path;
    }
    if (!photoPath) redirect(`/courses/${slug}/apply?error=photo-required`);

    if (finalAddress !== profile.address || photoPath !== profile.photo_path) {
      const { error: contactError } = await supabase
        .from('profiles')
        .update({ address: finalAddress, photo_path: photoPath })
        .eq('id', user.id);
      if (contactError) redirect(`/courses/${slug}/apply?error=conflict`);
    }
  }

  // 3) 최종 검증과 기록: 강좌 행을 잠근 한 트랜잭션에서 중복·모집 상태·정원을 다시 보고 쓴다(동시 신청·그 사이의 마감 반영).
  const outcome = await applyEnrollment(courseId);
  if (outcome === 'unauthenticated' || outcome === 'inactive') redirect('/sign-in');
  if (outcome === 'conflict' || outcome === 'failed') redirect(`/courses/${slug}/apply?error=conflict`);
  // ok · already_active · closed · full · course_not_found 모두 강좌 페이지가 현재 상태를 보여 준다
  redirect(`/courses/${slug}`);
}
