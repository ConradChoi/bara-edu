import { createClient } from '@/lib/supabase/server';
import type { DiagnosisTier } from '@/data/diagnosis/config';

// 도형심리 역량진단(/selfcheck) 학습자·비회원 공용 조회. 전부 SECURITY DEFINER RPC를
// 감싸는 얇은 래퍼다 — diagnosis_results/diagnosis_answers는 RLS가 admin-only라 직접
// select할 수 없고, 이 RPC들이 요약/상세/귀속을 각자의 게이팅 조건으로 대신 처리한다
// (get_diagnosis_summary/get_diagnosis_detail/claim_diagnosis, supabase/schema.sql 참고).

export type DiagnosisSummary = {
  recommendedTier: DiagnosisTier;
  totalScore: number;
  ctaLabel: string | null;
  ctaDescription: string | null;
  courseId: string | null;
  courseSlug: string | null;
  courseTitle: string | null;
  hasOwner: boolean;
  isOwnedByCaller: boolean;
};

// 결과를 찾지 못하면 null — 페이지가 "결과를 찾을 수 없어요" 화면으로 분기한다.
export async function getDiagnosisSummary(token: string): Promise<DiagnosisSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_diagnosis_summary', { p_token: token }).maybeSingle();
  if (error) {
    if (error.message.includes('result not found')) return null;
    throw new Error(error.message);
  }
  if (!data) return null;

  const row = data as {
    recommended_tier: DiagnosisTier;
    total_score: number;
    cta_label: string | null;
    cta_description: string | null;
    course_id: string | null;
    course_slug: string | null;
    course_title: string | null;
    has_owner: boolean;
    is_owned_by_caller: boolean;
  };
  return {
    recommendedTier: row.recommended_tier,
    totalScore: row.total_score,
    ctaLabel: row.cta_label,
    ctaDescription: row.cta_description,
    courseId: row.course_id,
    courseSlug: row.course_slug,
    courseTitle: row.course_title,
    hasOwner: row.has_owner,
    isOwnedByCaller: row.is_owned_by_caller,
  };
}

export type DiagnosisDetail = {
  respondentName: string;
  recommendedTier: DiagnosisTier;
  totalScore: number;
  scoreTheory: number;
  scoreReading: number;
  scoreAnalysis: number;
  scoreCounseling: number;
  scoreCaseRecord: number;
  scoreTeaching: number;
  strengthAreas: string[];
  improvementAreas: string[];
  createdAt: string;
};

// 로그인 + 본인 소유 결과가 아니면 RPC가 예외를 던진다 — 그 경우 null을 반환해 페이지가
// "거부" 화면으로 분기하게 한다(호출부에서 에러 메시지로 원인을 구분할 필요는 없다 —
// 어차피 State A로 되돌리고 동일한 잠금 안내를 보여준다).
export async function getDiagnosisDetail(token: string): Promise<DiagnosisDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_diagnosis_detail', { p_token: token }).maybeSingle();
  if (error) return null;
  if (!data) return null;

  const row = data as {
    respondent_name: string;
    recommended_tier: DiagnosisTier;
    total_score: number;
    score_theory: number;
    score_reading: number;
    score_analysis: number;
    score_counseling: number;
    score_case_record: number;
    score_teaching: number;
    strength_areas: string[];
    improvement_areas: string[];
    created_at: string;
  };
  return {
    respondentName: row.respondent_name,
    recommendedTier: row.recommended_tier,
    totalScore: row.total_score,
    scoreTheory: row.score_theory,
    scoreReading: row.score_reading,
    scoreAnalysis: row.score_analysis,
    scoreCounseling: row.score_counseling,
    scoreCaseRecord: row.score_case_record,
    scoreTeaching: row.score_teaching,
    strengthAreas: row.strength_areas ?? [],
    improvementAreas: row.improvement_areas ?? [],
    createdAt: row.created_at,
  };
}

export type MyDiagnosisResult = {
  accessToken: string;
  recommendedTier: DiagnosisTier;
  totalScore: number;
  createdAt: string;
};

// 마이페이지 "자가진단내역"용 — 로그인한 본인 계정에 연결된(claim된) 진단 결과 전체
// 목록. 이름/연락처/영역별 점수는 담지 않는다(최소수집 원칙, get_diagnosis_detail과 동일).
export async function getMyDiagnosisResults(): Promise<MyDiagnosisResult[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_my_diagnosis_results');
  if (error) throw new Error(error.message);

  return (
    data as { access_token: string; recommended_tier: DiagnosisTier; total_score: number; created_at: string }[]
  ).map((row) => ({
    accessToken: row.access_token,
    recommendedTier: row.recommended_tier,
    totalScore: row.total_score,
    createdAt: row.created_at,
  }));
}
