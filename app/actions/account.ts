'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/db/server';
import { changePassword as changeLoginPassword, logoutAll, withdrawAnonymize, withdrawCleanup } from '@/lib/db/auth';
import { clearSession } from '@/lib/db/session-cookie';
import { removeMemberPhoto, uploadMemberPhoto } from '@/lib/db/storage';
import { hasIncompleteApprovedEnrollment } from '@/lib/supabase/classroom-queries';
import { WITHDRAWAL_REASONS } from '@/data/account-settings';

const PHOTO_ERROR = { 'too-large': 'photo-too-large', invalid: 'photo-invalid', failed: 'failed' } as const;

// 회원 탈퇴 (flows.md Q10~Q12, bara-edu-lms.legal-privacy.md 제3조 2항)
// Q12: 진행 중인 강좌가 있으면 차단.
// Q10: 이름/연락처/이메일은 즉시 복구 불가능하게 익명화하고 학습 이력(진도/퀴즈/과제)은 파기한다.
// 거래(enrollments)·수료(certificates) 기록은 법정 보존기간 동안 user_id만으로 보존한다.
// 로그인 계정(auth.users) 익명화·비밀번호 무효화와 학습 이력 파기는 RLS를 넘어야 해서
// API의 전용 경로(withdraw-anonymize, account.withdrawCleanup)가 본인 세션으로만 수행한다.
//
// 단계마다 결과를 확인하고 실패 시 즉시 중단한다(qa-reviewer 점검, 2026-08-06 — 조용한 부분
// 실패로 "학습기록은 사라졌는데 계정은 살아있는" 상태가 되는 것을 방지). 가장 되돌리기 어려운
// PII 조치(이메일 익명화)를 먼저 수행하고, 학습 이력 파기는 그 뒤에 한다. API 연결 실패로
// 예외가 나도 액션 전체가 죽지 않고 기존 ?withdrawError=failed 배너로 끝나야 한다
// (대표 리포트, 2026-09-16).
//
// 탈퇴 사유(reason)는 필수, 상세 서술(detail)은 선택 — 사유 없이 바로 탈퇴되지 않아야 한다는
// 대표 요청(2026-09-16)에 따라 추가. 클라이언트가 임의 문자열을 보낼 수 있어 고정 목록에
// 있는 key인지 서버에서 재검증한다(다른 폼 검증과 동일 원칙).
export async function withdraw(formData: FormData) {
  const reason = formData.get('reason') as string | null;
  const detail = (formData.get('detail') as string | null)?.trim() || null;
  if (!reason || !WITHDRAWAL_REASONS.some((r) => r.key === reason)) {
    redirect('/my?withdrawError=validation');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  if (await hasIncompleteApprovedEnrollment(user.id)) {
    redirect('/my?withdrawError=active-enrollment');
  }

  // 탈퇴 후 profiles.photo_path를 null로 비우면 이 값을 잃어버리므로, 스토리지에서
  // 실제 파일을 지우기 전에 미리 읽어둔다(주소/사진도 이름·이메일과 동일하게 즉시
  // 파기 대상이다 — 2026-08-28, 자격증 발급용 사진/주소 수집 추가에 따른 확장).
  const { data: contactRow } = await supabase.from('profiles').select('photo_path').eq('id', user.id).maybeSingle();
  const photoPathToDelete = contactRow?.photo_path ?? null;

  const anonymizedEmail = `withdrawn+${user.id}@deleted.invalid`;
  if (!(await attempt(withdrawAnonymize(anonymizedEmail)))) redirect('/my?withdrawError=failed');

  // profiles.email은 auth.users.email의 복제본(관리자 검색용, module-lms-6)이라
  // 위와 동일한 값으로 맞추지 않으면 탈퇴 전 이메일이 그대로 남아 익명화가 무의미해진다.
  const profileUpdated = await attempt(
    supabase
      .from('profiles')
      .update({
        name: '탈퇴한 회원',
        phone: null,
        email: anonymizedEmail,
        address: null,
        photo_path: null,
        status: 'withdrawn',
        withdrawn_at: new Date().toISOString(),
        withdrawal_reason: reason,
        withdrawal_reason_detail: detail,
      })
      .eq('id', user.id)
      .then(({ error }) => !error),
  );
  if (!profileUpdated) redirect('/my?withdrawError=failed');

  // 진도·퀴즈·과제·자격시험 기록 파기와 역량진단 결과 익명화·문의 삭제(privacy-security-officer
  // C-2, 2026-09-14)는 API의 account.withdrawCleanup 한 번에 처리된다.
  if (!(await attempt(withdrawCleanup()))) redirect('/my?withdrawError=failed');

  if (photoPathToDelete) {
    // 실패해도 탈퇴 자체를 막지는 않는다 — profiles.photo_path는 이미 null로 비워졌으니
    // 개인정보 조회 경로는 차단됐고, 스토리지에 파일이 남는 것은 별도 정리(운영) 대상이다.
    await removeMemberPhoto(photoPathToDelete);
  }

  // 전역 로그아웃: 다른 기기/탭에 남아있던 세션까지 끊는다(security-officer 점검, 2026-08-08).
  // 계정은 이미 익명화됐으니 실패해도 탈퇴는 성공으로 끝낸다.
  await attempt(logoutAll());
  await clearSession();
  redirect('/?withdrawn=1');
}

function attempt(p: PromiseLike<boolean>): Promise<boolean> {
  return Promise.resolve(p).catch(() => false);
}

// 로그인 비밀번호 변경 (마이페이지 "계정", 대표 요청 2026-09-16 — 이름/휴대전화는 지원하지
// 않되 비밀번호 변경은 필요). 자리를 비운 사이 남의 손에 들어간 브라우저에서 곧바로 계정을
// 탈취당하지 않도록 현재 비밀번호를 다시 확인해야만 바꿀 수 있다 — API의 change-password가
// 현재 비밀번호를 검증하고, 다른 기기의 세션을 끊는다(지금 쓰는 쿠키는 그대로 유효).
export async function changePassword(formData: FormData) {
  const currentPassword = (formData.get('currentPassword') as string | null) ?? '';
  const newPassword = (formData.get('newPassword') as string | null) ?? '';
  const confirmPassword = (formData.get('confirmPassword') as string | null) ?? '';

  if (!currentPassword || newPassword.length < 8 || newPassword !== confirmPassword) {
    redirect('/my?settingsError=password-validation');
  }

  const r = await changeLoginPassword(currentPassword, newPassword);
  if (!r.ok) {
    if (r.reason === 'unauthenticated') redirect('/sign-in');
    redirect(r.reason === 'wrong_current' ? '/my?settingsError=current-password-wrong' : '/my?settingsError=failed');
  }

  redirect('/my?settingsSuccess=password');
}

// 수강신청 시 등록한 주소/사진 수정 (마이페이지 "계정"). app/actions/enrollment.ts의
// applyToCourse()와 동일한 검증(사진 매직바이트 확인, 5MB 제한, 고정 경로 업로드 —
// lib/db/storage.ts의 uploadMemberPhoto)을 그대로 재사용한다 — 두 곳 다 같은 profiles.address/photo_path를 다루므로 검증이
// 어긋나면 한쪽만 느슨해지는 문제가 생긴다.
export async function updateContactInfo(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: profile } = await supabase.from('profiles').select('address, photo_path').eq('id', user.id).maybeSingle();
  if (!profile) redirect('/my?settingsError=failed');

  const addressInput = (formData.get('address') as string | null)?.trim();
  const finalAddress = addressInput || profile.address;

  const photoFile = formData.get('photo') as File | null;
  let photoPath = profile.photo_path;
  if (photoFile && photoFile.size > 0) {
    const uploaded = await uploadMemberPhoto(photoFile);
    if ('error' in uploaded) redirect(`/my?settingsError=${PHOTO_ERROR[uploaded.error]}`);
    photoPath = uploaded.path;
  }

  if (finalAddress === profile.address && photoPath === profile.photo_path) {
    redirect('/my?settingsSuccess=contact');
  }

  const { error } = await supabase.from('profiles').update({ address: finalAddress, photo_path: photoPath }).eq('id', user.id);
  if (error) redirect('/my?settingsError=failed');

  redirect('/my?settingsSuccess=contact');
}
