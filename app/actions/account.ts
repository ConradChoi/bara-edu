'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/db/server';
import { changePassword as changeLoginPassword, withdrawAccount, type WithdrawResult } from '@/lib/db/auth';
import { clearSession } from '@/lib/db/session-cookie';
import { uploadMemberPhoto } from '@/lib/db/storage';
import { WITHDRAWAL_REASONS } from '@/data/account-settings';
import { LIMITS } from '@/lib/form-messages';

const PHOTO_ERROR = { 'too-large': 'photo-too-large', invalid: 'photo-invalid', failed: 'photo-failed' } as const;

// 회원 탈퇴 (flows.md Q10~Q12, bara-edu-lms.legal-privacy.md 제3조 2항)
// Q12: 진행 중인 강좌가 있으면 차단.
// Q10: 이름/연락처/이메일은 즉시 복구 불가능하게 익명화하고 학습 이력(진도/퀴즈/과제)은 파기한다.
// 거래(enrollments)·수료(certificates) 기록은 법정 보존기간 동안 user_id만으로 보존한다.
//
// R24: 예전에는 이 액션이 API를 여러 번 불러(학습 이력 파기 → 계정 익명화 → profiles 갱신 → 사진 삭제 →
// 전체 로그아웃) 중간 실패 시 반쯤 탈퇴된 상태가 남을 수 있었다. 지금은 POST /v1/account/withdraw 한 번이
// 검증(진행 중 수강)부터 세션 삭제까지 한 DB 트랜잭션으로 처리하고, 사진 삭제는 커밋 뒤에 API가 한다
// (실패해도 탈퇴는 성공). API 연결 실패로 예외가 나도 액션 전체가 죽지 않고 ?withdrawError=failed 배너로 끝난다.
//
// 탈퇴 사유(reason)는 필수, 상세 서술(detail)은 선택 — 사유 없이 바로 탈퇴되지 않아야 한다는
// 대표 요청(2026-09-16). 클라이언트가 임의 문자열을 보낼 수 있어 고정 목록에 있는 key인지 서버에서 재검증한다.
export async function withdraw(formData: FormData) {
  const reason = formData.get('reason') as string | null;
  const detail = (formData.get('detail') as string | null)?.trim() || null;
  if (!reason || !WITHDRAWAL_REASONS.some((r) => r.key === reason)) {
    redirect('/my?withdrawError=validation');
  }

  const r = await withdrawAccount(reason, detail).catch((): WithdrawResult => ({ ok: false, reason: 'failed' }));
  if (!r.ok) {
    if (r.reason === 'unauthenticated') redirect('/sign-in');
    redirect(r.reason === 'active_enrollment' ? '/my?withdrawError=active-enrollment' : '/my?withdrawError=failed');
  }

  await clearSession();
  redirect('/?withdrawn=1');
}

// 로그인 비밀번호 변경 (마이페이지 "계정", 대표 요청 2026-09-16 — 이름/휴대전화는 지원하지
// 않되 비밀번호 변경은 필요). 자리를 비운 사이 남의 손에 들어간 브라우저에서 곧바로 계정을
// 탈취당하지 않도록 현재 비밀번호를 다시 확인해야만 바꿀 수 있다 — API의 change-password가
// 현재 비밀번호를 검증하고, 다른 기기의 세션을 끊는다(지금 쓰는 쿠키는 그대로 유효).
export async function changePassword(formData: FormData) {
  const currentPassword = (formData.get('currentPassword') as string | null) ?? '';
  const newPassword = (formData.get('newPassword') as string | null) ?? '';
  const confirmPassword = (formData.get('confirmPassword') as string | null) ?? '';

  if (!currentPassword || newPassword.length < 8 || newPassword.length > LIMITS.password || newPassword !== confirmPassword) {
    redirect('/my?settingsError=password-validation');
  }
  // API 한도(200자)를 넘는 현재 비밀번호는 맞을 수 없다.
  if (currentPassword.length > LIMITS.password) redirect('/my?settingsError=current-password-wrong');

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
