'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasIncompleteApprovedEnrollment } from '@/lib/supabase/classroom-queries';

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
export async function withdraw() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  if (await hasIncompleteApprovedEnrollment(user.id)) {
    redirect('/my?withdrawError=active-enrollment');
  }

  // 다른 기기/탭에 이미 발급된 세션의 access_token을 미리 확보해둔다 — 이메일/비밀번호를
  // 바꿔도 이미 발급된 토큰은 자동으로 무효화되지 않으므로, 아래에서 전역 로그아웃에 쓴다
  // (security-officer 점검, 2026-08-08: 탈퇴 후에도 다른 기기 세션이 남아있던 문제).
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const admin = createAdminClient();
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
      status: 'withdrawn',
      withdrawn_at: new Date().toISOString(),
    })
    .eq('id', user.id);
  if (profileError) redirect('/my?withdrawError=failed');

  const { error: progressError } = await admin.from('progress').delete().eq('user_id', user.id);
  const { error: quizError } = await admin.from('quiz_submissions').delete().eq('user_id', user.id);
  const { error: assignmentError } = await admin.from('assignment_submissions').delete().eq('user_id', user.id);
  if (progressError || quizError || assignmentError) redirect('/my?withdrawError=failed');

  // 전역 로그아웃: 이메일/비밀번호를 바꿔도 이미 발급된 세션의 refresh token은 자동으로
  // 무효화되지 않아, 다른 기기/탭에 남아있던 세션이 계속 유효할 수 있었다
  // (security-officer 점검, 2026-08-08). 로컬 signOut()보다 먼저 호출한다.
  if (session) {
    await admin.auth.admin.signOut(session.access_token, 'global');
  }

  await supabase.auth.signOut();
  redirect('/?withdrawn=1');
}
