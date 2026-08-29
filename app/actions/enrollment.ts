'use server';

import { redirect } from 'next/navigation';
import { getApprovedSeatsTaken } from '@/lib/supabase/queries';
import { createClient } from '@/lib/supabase/server';

const PAYMENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // flows.md Q2: 입금 기한 3일

// 자격증 발급용 사진 업로드 검증에 쓴다 — File.type(브라우저 자기신고 값)이 아니라 실제
// 바이트 시그니처로 JPEG/PNG/GIF/WebP만 허용한다. image/svg+xml처럼 스크립트를 담을 수
// 있는 포맷이 MIME 문자열 검사만으로 통과되는 걸 막는다(security-officer 점검, 2026-08-28).
function detectImageMimeType(header: Uint8Array): string | null {
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg';
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) return 'image/png';
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) return 'image/gif';
  if (
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

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

  // 주소/사진은 회원당 1회만 받아 재사용한다(관리자 요청, 2026-08-28) — 이미 등록돼
  // 있으면 이번 신청에서 값을 새로 안 보내도 기존 값을 그대로 쓴다.
  if (course!.requires_certificate_info) {
    const addressInput = (formData.get('address') as string | null)?.trim();
    const finalAddress = addressInput || profile.address;
    if (!finalAddress) redirect(`/courses/${slug}/apply?error=address-required`);

    const photoFile = formData.get('photo') as File | null;
    let photoPath = profile.photo_path;
    if (photoFile && photoFile.size > 0) {
      if (photoFile.size > 5 * 1024 * 1024) redirect(`/courses/${slug}/apply?error=photo-too-large`);

      // File.type은 브라우저가 보낸 자기신고 값이라 실제 바이트를 신뢰하지 않는다 —
      // image/svg+xml처럼 MIME 검사만으로는 걸러지지 않는 스크립트 포함 가능 포맷을
      // 허용하지 않도록 실제 매직바이트로 JPEG/PNG/GIF/WebP만 판별한다
      // (security-officer 점검, 2026-08-28).
      const header = new Uint8Array(await photoFile.slice(0, 12).arrayBuffer());
      const detectedType = detectImageMimeType(header);
      if (!detectedType) redirect(`/courses/${slug}/apply?error=photo-invalid`);

      const path = `${user.id}/photo`;
      const { error: uploadError } = await supabase.storage
        .from('member-photos')
        .upload(path, photoFile, { upsert: true, contentType: detectedType });
      if (uploadError) redirect(`/courses/${slug}/apply?error=conflict`);
      photoPath = path;
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
  // qa-reviewer 점검, 2026-08-09). course는 이 액션 실행 시점에 위에서 이미 새로 조회해둔
  // 값이라 다시 조회할 필요 없다(2026-08-29, requires_certificate_info 분기 추가하며 통합).
  if (!['active', 'upcoming'].includes(course!.status)) {
    redirect(`/courses/${slug}`);
  }
  const seatsTaken = await getApprovedSeatsTaken([courseId]);
  if ((seatsTaken[courseId] ?? 0) >= course!.seats) {
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
