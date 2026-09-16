'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { detectImageMimeType } from '@/lib/image-validation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasIncompleteApprovedEnrollment } from '@/lib/supabase/classroom-queries';
import { WITHDRAWAL_REASONS } from '@/data/account-settings';

// 회원 탈퇴 (flows.md Q10~Q12, bara-edu-lms.legal-privacy.md 제3조 2항)
// Q12: 진행 중인 강좌가 있으면 차단.
// Q10: 이름/연락처/이메일은 즉시 복구 불가능하게 익명화하고 학습 이력(진도/퀴즈/과제)은 파기한다.
// 거래(enrollments)·수료(certificates) 기록은 법정 보존기간 동안 user_id만으로 보존한다.
// auth.users 이메일 익명화·비밀번호 무효화는 anon 키(RLS)로는 불가능해 service_role 기반
// admin 클라이언트가 필요하다(security-officer 점검 후 product-manager 정책 결정, 2026-08-06).
//
// 단계마다 error를 확인하고 실패 시 즉시 중단한다(qa-reviewer 점검, 2026-08-06 — 조용한 부분
// 실패로 "학습기록은 사라졌는데 계정은 살아있는" 상태가 되는 것을 방지). 가장 되돌리기 어려운
// PII 조치(이메일 익명화)를 먼저 수행하고, 학습 이력 파기는 마지막에 한다.
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

  // 다른 기기/탭에 이미 발급된 세션의 access_token을 미리 확보해둔다 — 이메일/비밀번호를
  // 바꿔도 이미 발급된 토큰은 자동으로 무효화되지 않으므로, 아래에서 전역 로그아웃에 쓴다
  // (security-officer 점검, 2026-08-08: 탈퇴 후에도 다른 기기 세션이 남아있던 문제).
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // createAdminClient()는 SUPABASE_SERVICE_ROLE_KEY가 서버 환경변수에 없으면 그 자리에서
  // 예외를 던진다 — try/catch 없이 호출하면 이 서버 액션 전체가 처리되지 않은 예외로 죽어
  // "회원탈퇴가 안 된다"는 증상으로만 보이고 원인을 알 수 없었다(대표 리포트, 2026-09-16 —
  // 같은 환경변수 문제가 하루 전 관리자 PII 열람 기능에서도 동일하게 재현됐다). 실패해도
  // 기존 ?withdrawError=failed 배너로 안전하게 처리하고 실제 원인은 서버 로그에 남긴다.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    console.error('[withdraw] admin client unavailable (SUPABASE_SERVICE_ROLE_KEY?):', err);
    redirect('/my?withdrawError=failed');
  }
  const anonymizedEmail = `withdrawn+${user.id}@deleted.invalid`;

  const { error: authError } = await admin.auth.admin.updateUserById(user.id, {
    email: anonymizedEmail,
    password: randomUUID(),
    user_metadata: {},
  });
  if (authError) redirect('/my?withdrawError=failed');

  // profiles.email은 auth.users.email의 복제본(관리자 검색용, module-lms-6)이라
  // 위와 동일한 값으로 맞추지 않으면 탈퇴 전 이메일이 그대로 남아 익명화가 무의미해진다.
  // 이 update는 본인 세션(anon 키)으로 하는 것이라, 이 시점 이후로 세션을 무효화해야
  // 아래 작업들이 안전하게 끝난다.
  const { error: profileError } = await supabase
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
    .eq('id', user.id);
  if (profileError) redirect('/my?withdrawError=failed');

  const { error: progressError } = await admin.from('progress').delete().eq('user_id', user.id);
  const { error: quizError } = await admin.from('quiz_submissions').delete().eq('user_id', user.id);
  const { error: assignmentError } = await admin.from('assignment_submissions').delete().eq('user_id', user.id);
  // 자격시험 응시 기록·리셋 이력도 진도/퀴즈/과제와 동일한 "학습 이력" 범주라 함께 파기한다
  // (privacy-security-officer 지적, 2026-09-09 — module-lms-9 추가 당시 누락됐던 부분).
  const { error: examSubmissionError } = await admin.from('course_exam_submissions').delete().eq('user_id', user.id);
  const { error: examResetError } = await admin.from('course_exam_attempt_resets').delete().eq('user_id', user.id);
  // 도형심리 역량진단(/selfcheck) 결과·강사과정 문의도 이름/연락처/연락 메시지라는 PII를
  // 직접 들고 있어 위 학습 이력과 동일하게 취급해야 한다 — 탈퇴해도 계정에 연결된 진단
  // 결과가 원문 그대로 남아있던 문제(privacy-security-officer C-2 지적, 2026-09-14).
  // 진단 결과는 점수·판정만 통계로 남기고(90일 미귀속 자동 파기와 동일한 방식) 문의는
  // 리드 자체를 삭제한다(admin_note 등 남길 값이 없어 익명화보다 삭제가 적절).
  const { error: diagnosisResultError } = await admin
    .from('diagnosis_results')
    .update({ respondent_name: null, phone: null, email: null, certificate_level: null })
    .eq('user_id', user.id);
  const { error: diagnosisLeadError } = await admin.from('diagnosis_leads').delete().eq('user_id', user.id);
  if (progressError || quizError || assignmentError || examSubmissionError || examResetError || diagnosisResultError || diagnosisLeadError) {
    redirect('/my?withdrawError=failed');
  }

  if (photoPathToDelete) {
    // 실패해도 탈퇴 자체를 막지는 않는다 — profiles.photo_path는 이미 null로 비워졌으니
    // 개인정보 조회 경로는 차단됐고, 스토리지에 파일이 남는 것은 별도 정리(운영) 대상이다.
    await admin.storage.from('member-photos').remove([photoPathToDelete]);
  }

  // 전역 로그아웃: 이메일/비밀번호를 바꿔도 이미 발급된 세션의 refresh token은 자동으로
  // 무효화되지 않아, 다른 기기/탭에 남아있던 세션이 계속 유효할 수 있었다
  // (security-officer 점검, 2026-08-08). 로컬 signOut()보다 먼저 호출한다.
  if (session) {
    await admin.auth.admin.signOut(session.access_token, 'global');
  }

  await supabase.auth.signOut();
  redirect('/?withdrawn=1');
}

// 로그인 비밀번호 변경 (마이페이지 "계정", 대표 요청 2026-09-16 — 이름/휴대전화는 지원하지
// 않되 비밀번호 변경은 필요). 이미 로그인된 세션이라 supabase.auth.updateUser()만으로도
// 비밀번호를 바꿀 수 있지만, 그렇게 하면 자리를 비운 사이 남의 손에 들어간 브라우저에서
// 곧바로 계정을 탈취(비밀번호를 바꿔 원 소유자를 로그아웃 상태로 만드는 것)당할 수 있다 —
// 현재 비밀번호를 다시 확인해야만 바꿀 수 있게 한다(signInWithPassword로 재검증).
export async function changePassword(formData: FormData) {
  const currentPassword = (formData.get('currentPassword') as string | null) ?? '';
  const newPassword = (formData.get('newPassword') as string | null) ?? '';
  const confirmPassword = (formData.get('confirmPassword') as string | null) ?? '';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) redirect('/sign-in');

  if (!currentPassword || newPassword.length < 8 || newPassword !== confirmPassword) {
    redirect('/my?settingsError=password-validation');
  }

  const { error: reauthError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (reauthError) redirect('/my?settingsError=current-password-wrong');

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) redirect('/my?settingsError=failed');

  redirect('/my?settingsSuccess=password');
}

// 수강신청 시 등록한 주소/사진 수정 (마이페이지 "계정"). app/actions/enrollment.ts의
// applyToCourse()와 동일한 검증(사진 매직바이트 확인, 5MB 제한, 고정 경로 업로드)을
// 그대로 재사용한다 — 두 곳 다 같은 profiles.address/photo_path를 다루므로 검증이
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
    if (photoFile.size > 5 * 1024 * 1024) redirect('/my?settingsError=photo-too-large');

    const header = new Uint8Array(await photoFile.slice(0, 12).arrayBuffer());
    const detectedType = detectImageMimeType(header);
    if (!detectedType) redirect('/my?settingsError=photo-invalid');

    const path = `${user.id}/photo`;
    const { error: uploadError } = await supabase.storage
      .from('member-photos')
      .upload(path, photoFile, { upsert: true, contentType: detectedType });
    if (uploadError) redirect('/my?settingsError=failed');
    photoPath = path;
  }

  if (finalAddress === profile.address && photoPath === profile.photo_path) {
    redirect('/my?settingsSuccess=contact');
  }

  const { error } = await supabase.from('profiles').update({ address: finalAddress, photo_path: photoPath }).eq('id', user.id);
  if (error) redirect('/my?settingsError=failed');

  redirect('/my?settingsSuccess=contact');
}
