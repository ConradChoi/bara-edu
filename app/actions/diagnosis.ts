'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getLegalDocument } from '@/lib/supabase/queries';
import { DIAGNOSIS_QUESTIONS } from '@/data/diagnosis/questions';
import { RECENT_SUBMIT_COOKIE } from '@/data/diagnosis/config';

// 도형심리 역량진단(/selfcheck) 학습자·비회원 공용 액션. 채점·판정·게이팅은 전부
// supabase/schema.sql의 SECURITY DEFINER RPC가 서버에서 재검증한다(자격시험 RPC와 동일
// 원칙 — 클라이언트가 계산한 점수·추천 결과는 신뢰하지 않는다).
//
// RECENT_SUBMIT_COOKIE("이 브라우저가 방금 이 토큰을 제출했다"는 신호)는 data/diagnosis/config.ts에
// 정의한다 — 'use server' 파일은 async 함수 외의 값을 export할 수 없어 여기 두면 안 된다.
// httpOnly라 클라이언트 JS/쿼리파라미터로 위조할 수 없다 — 결과 페이지가 로그인/가입 확인
// 절차 없이 자동 귀속(AutoClaim)을 허용할지 이 쿠키만으로 판단한다(qa-reviewer +
// privacy-security-officer 공통 지적 C-5 수정: 이전에는 `?claim=auto` 쿼리파라미터를 그대로
// 신뢰해 공유받은 링크를 아무나 열어 로그인만 해도 확인 없이 귀속될 수 있었다). 회원가입은
// 이메일 인증이라는 비동기 왕복을 거치므로(수 분~수십 분 소요 가능) 넉넉한 24시간으로 잡는다.

// 30문항 전부 응답했는지, 값이 0~4 범위인지는 여기서도 한 번 더 확인한다 — RPC도
// 동일하게 검증하지만, 잘못된 요청이면 RPC까지 왕복하지 않고 여기서 바로 되돌린다.
export async function submitDiagnosis(formData: FormData) {
  const name = (formData.get('name') as string | null)?.trim();
  const phone = (formData.get('phone') as string | null)?.trim() || null;
  const email = (formData.get('email') as string | null)?.trim() || null;
  const learningExperience = formData.get('learningExperience') as string | null;
  const certificateLevel = (formData.get('certificateLevel') as string | null)?.trim() || null;
  const consentPrivacy = formData.get('consentPrivacy') === 'on';
  const ageConfirmed = formData.get('ageConfirmed') === 'on';

  // 연락처는 휴대전화·이메일 중 최소 1개만 필수(최소수집 원칙, 대표 결정 2026-09-14).
  if (!name || (!phone && !email) || !learningExperience || !consentPrivacy || !ageConfirmed) {
    redirect('/selfcheck/start?error=validation');
  }

  const answers: Record<string, number> = {};
  for (const q of DIAGNOSIS_QUESTIONS) {
    const raw = formData.get(q.code);
    if (raw === null) redirect('/selfcheck/start?error=incomplete');
    const score = Number(raw);
    if (!Number.isInteger(score) || score < 0 || score > 4) redirect('/selfcheck/start?error=validation');
    answers[q.code] = score;
  }

  // 동의 시점의 개인정보처리방침 버전을 스냅샷으로 남긴다(향후 방침이 개정돼도 "그때
  // 무엇에 동의했는지"가 흔들리지 않게) — 게시된 버전이 없으면 null로 둔다.
  const privacyDoc = await getLegalDocument('privacy');

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc('submit_diagnosis', {
      p_name: name,
      p_phone: phone,
      p_email: email,
      p_learning_experience: learningExperience,
      p_certificate_level: certificateLevel,
      p_consent_privacy: consentPrivacy,
      p_consent_privacy_doc_version: privacyDoc?.version ?? null,
      p_age_confirmed: ageConfirmed,
      p_answers: answers,
    })
    .single();

  if (error) redirect('/selfcheck/start?error=submit-failed');

  const token = (data as { access_token: string }).access_token;

  const cookieStore = await cookies();
  cookieStore.set(RECENT_SUBMIT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/selfcheck',
    maxAge: 60 * 60 * 24,
  });

  redirect(`/selfcheck/result/${token}`);
}

// 로그인/회원가입 라운드트립 양쪽 모두 이 액션으로 귀결된다(버튼 클릭 시 수동 확인,
// 또는 result 페이지의 AutoClaim이 자동 제출) — claim_diagnosis() RPC가 "미귀속 결과만
// 최초 1회" 조건을 원자적으로 처리한다.
export async function claimDiagnosis(token: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('claim_diagnosis', { p_token: token });
  if (error) redirect(`/selfcheck/result/${token}?claimDenied=1`);
  redirect(`/selfcheck/result/${token}`);
}

// tier=instructor_candidate일 때만 노출되는 강사과정 관심 문의 폼 제출. tier 재검증은
// submit_diagnosis_lead() RPC가 서버에서 한다(화면 조작으로 다른 tier에서 보내는 경로 차단).
export async function submitDiagnosisLead(token: string, formData: FormData) {
  const name = (formData.get('name') as string | null)?.trim();
  const contact = (formData.get('contact') as string | null)?.trim();
  const message = (formData.get('message') as string | null)?.trim() || null;
  const consentContact = formData.get('consentContact') === 'on';

  if (!name || !contact || !consentContact) {
    redirect(`/selfcheck/result/${token}?leadError=validation`);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_diagnosis_lead', {
    p_token: token,
    p_name: name,
    p_contact: contact,
    p_message: message,
    p_consent_contact: consentContact,
  });
  if (error) redirect(`/selfcheck/result/${token}?leadError=failed`);
  redirect(`/selfcheck/result/${token}?leadSuccess=1`);
}
