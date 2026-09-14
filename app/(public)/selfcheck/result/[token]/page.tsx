import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { claimDiagnosis } from '@/app/actions/diagnosis';
import AutoClaim from '@/components/diagnosis/AutoClaim';
import LeadForm from '@/components/diagnosis/LeadForm';
import PendingClaimLink from '@/components/diagnosis/PendingClaimLink';
import PrintButton from '@/components/diagnosis/PrintButton';
import RadarChart from '@/components/diagnosis/RadarChart';
import ScoreBar from '@/components/diagnosis/ScoreBar';
import { DIAGNOSIS_AREAS, DIAGNOSIS_DISCLAIMER, DIAGNOSIS_TIER_LABELS, RECENT_SUBMIT_COOKIE } from '@/data/diagnosis/config';
import { getDiagnosisDetail, getDiagnosisSummary } from '@/lib/supabase/diagnosis-queries';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: '진단 결과 | 도형심리 역량진단' };

export default async function DiagnosisResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ claimDenied?: string; leadSuccess?: string; leadError?: string }>;
}) {
  const { token } = await params;
  const { claimDenied, leadSuccess, leadError } = await searchParams;

  // 방금 이 토큰을 제출한 바로 그 브라우저인지는 httpOnly 쿠키로만 판단한다 — 쿼리파라미터는
  // 누구나 재현할 수 있어 신뢰할 수 없다(qa-reviewer + privacy-security-officer 공통 지적).
  const cookieStore = await cookies();
  const isRecentSubmitter = cookieStore.get(RECENT_SUBMIT_COOKIE)?.value === token;

  const summary = await getDiagnosisSummary(token);
  if (!summary) {
    return (
      <div className="mx-auto flex max-w-[420px] flex-col items-center gap-3 px-6 py-16 text-center">
        <p className="text-[15px] font-semibold text-n-9">결과를 찾을 수 없어요</p>
        <p className="text-[12.5px] text-n-6">링크가 정확한지 확인해주세요.</p>
        <Link href="/selfcheck" className="mt-2 rounded-pill bg-pink px-5 py-2 text-[13px] font-semibold text-white">
          새로 진단받기
        </Link>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const tierLabel = DIAGNOSIS_TIER_LABELS[summary.recommendedTier];
  const isInstructorCandidate = summary.recommendedTier === 'instructor_candidate';

  // 로그인 + 다른 계정에 이미 귀속된 결과 — 상세는 절대 반환/렌더하지 않는다.
  if (user && summary.hasOwner && !summary.isOwnedByCaller) {
    return (
      <div className="mx-auto flex max-w-[420px] flex-col gap-4 px-6 py-10">
        <ResultSummaryCard summary={summary} tierLabel={tierLabel} />
        <div className="rounded-lg border border-warning bg-warning/10 px-4 py-3.5 text-[12.5px] font-medium text-warning">
          이 진단 결과는 이미 다른 계정에 연결되어 있어요. 본인의 결과가 맞다면 고객센터로 문의해주세요.
        </div>
      </div>
    );
  }

  // 로그인 + 이 브라우저가 방금 제출한 토큰(httpOnly 쿠키 일치) + 아직 미귀속 → 확인 없이 귀속.
  if (user && !summary.hasOwner && isRecentSubmitter) {
    return (
      <div className="mx-auto flex max-w-[420px] flex-col items-center gap-3 px-6 py-16 text-center">
        <p className="text-[13px] text-n-6">결과를 연결하는 중이에요...</p>
        <AutoClaim action={claimDiagnosis.bind(null, token)} />
      </div>
    );
  }

  // 로그인 + 미귀속 + 제출 브라우저가 아님(공유받은 링크를 로그인 상태로 열람) → 확인 후 귀속.
  const showClaimPrompt = Boolean(user) && !summary.hasOwner && !isRecentSubmitter;

  // 상세는 "본인 소유로 확정된 경우"에만 조회한다 — 그 외(비로그인/미귀속/확인대기)에는 요약만.
  const detail = user && summary.isOwnedByCaller ? await getDiagnosisDetail(token) : null;

  return (
    <div className="mx-auto flex max-w-[520px] flex-col gap-5 px-6 py-10">
      {claimDenied === '1' && (
        <div className="rounded-md border border-warning bg-warning/10 px-3.5 py-3 text-[13px] font-medium text-warning">
          결과 연결에 실패했어요. 이미 다른 계정에 연결되어 있을 수 있어요.
        </div>
      )}

      <ResultSummaryCard summary={summary} tierLabel={tierLabel} />

      {showClaimPrompt && (
        <div className="flex flex-col gap-2 rounded-lg border border-n-3 bg-n-1 p-4">
          <p className="text-[12.5px] text-n-9">이 진단 결과가 본인 것이 맞나요? 내 계정에 연결하면 상세 결과를 볼 수 있어요.</p>
          <form action={claimDiagnosis.bind(null, token)}>
            <button type="submit" className="h-10 w-full rounded-pill bg-pink text-[13px] font-semibold text-white">
              이 결과를 내 계정에 연결하기
            </button>
          </form>
        </div>
      )}

      {detail ? (
        <DetailSection detail={detail} />
      ) : (
        !showClaimPrompt && (
          <div className="print-hide flex flex-col gap-3 rounded-lg border border-warning bg-warning/10 p-4">
            <p className="text-[12.5px] font-medium text-n-9">
              영역별 상세, Radar 차트, 강점·보완 해석, PDF 저장은 로그인 후 확인할 수 있어요
            </p>
            <div className="flex gap-2">
              <Link
                href={`/sign-in?redirect=${encodeURIComponent(`/selfcheck/result/${token}`)}`}
                className="h-10 flex-1 rounded-pill border border-n-3 text-center text-[13px] font-medium leading-[38px] text-n-7"
              >
                로그인
              </Link>
              <PendingClaimLink
                token={token}
                className="flex h-10 flex-1 items-center justify-center rounded-pill bg-pink text-[13px] font-semibold text-white"
              >
                회원가입
              </PendingClaimLink>
            </div>
          </div>
        )
      )}

      {isInstructorCandidate && (
        <div className="print-hide">
          <LeadForm
            token={token}
            prefillName={detail?.respondentName}
            leadSuccess={leadSuccess === '1'}
            leadError={leadError}
          />
        </div>
      )}

      <p className="print-hide text-[11px] text-n-5">{DIAGNOSIS_DISCLAIMER}</p>
    </div>
  );
}

function ResultSummaryCard({
  summary,
  tierLabel,
}: {
  summary: Awaited<ReturnType<typeof getDiagnosisSummary>>;
  tierLabel: string;
}) {
  if (!summary) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-n-1 p-5">
      <p className="text-[11.5px] text-n-6">추천 과정</p>
      <p className="text-[17px] font-semibold text-n-9">{tierLabel}</p>
      <p className="flex items-baseline gap-1.5">
        <span className="text-[30px] font-semibold text-pink">{Math.round(summary.totalScore)}</span>
        <span className="text-[13px] text-n-6">/ 100점</span>
      </p>
      {summary.courseTitle && <p className="text-[13px] font-semibold text-n-9">{summary.courseTitle}</p>}
      <p className="text-[11px] text-n-6">{DIAGNOSIS_DISCLAIMER}</p>
      {summary.courseSlug ? (
        <Link href={`/courses/${summary.courseSlug}`} className="print-hide mt-1 h-11 w-full rounded-pill bg-pink text-center text-[13px] font-semibold leading-[44px] text-white">
          {summary.ctaLabel ?? '과정 자세히 보기'}
        </Link>
      ) : (
        <Link href="/#apply-guide" className="print-hide mt-1 h-11 w-full rounded-pill bg-pink text-center text-[13px] font-semibold leading-[44px] text-white">
          문의하기
        </Link>
      )}
    </div>
  );
}

function DetailSection({ detail }: { detail: NonNullable<Awaited<ReturnType<typeof getDiagnosisDetail>>> }) {
  const scores: Record<string, number> = {
    theory: detail.scoreTheory,
    reading: detail.scoreReading,
    analysis: detail.scoreAnalysis,
    counseling: detail.scoreCounseling,
    case_record: detail.scoreCaseRecord,
    teaching: detail.scoreTeaching,
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        <p className="text-[14px] font-semibold text-n-9">6영역 점수</p>
        {DIAGNOSIS_AREAS.map((area) => (
          <ScoreBar key={area.code} label={area.name} value={scores[area.dbKey]} />
        ))}
      </div>

      <div className="flex flex-col items-center gap-1">
        <RadarChart labels={DIAGNOSIS_AREAS.map((a) => a.name)} values={DIAGNOSIS_AREAS.map((a) => scores[a.dbKey])} />
        <p className="text-[10.5px] text-n-5">(스크린리더용) 위 Radar와 동일한 수치는 위 6영역 점수에 병기됨</p>
      </div>

      {detail.strengthAreas.length > 0 || detail.improvementAreas.length > 0 ? (
        <div className="flex flex-col gap-2">
          {detail.strengthAreas.map((code) => {
            const area = DIAGNOSIS_AREAS.find((a) => a.dbKey === code);
            if (!area) return null;
            return (
              <div key={`s-${code}`} className="flex items-start gap-2">
                <span className="shrink-0 rounded-pill bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">강점</span>
                <p className="text-[12.5px] text-n-7">
                  <span className="font-semibold text-n-9">{area.name}</span> — {area.strengthCopy}
                </p>
              </div>
            );
          })}
          {detail.improvementAreas.map((code) => {
            const area = DIAGNOSIS_AREAS.find((a) => a.dbKey === code);
            if (!area) return null;
            return (
              <div key={`i-${code}`} className="flex items-start gap-2">
                <span className="shrink-0 rounded-pill bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">보완</span>
                <p className="text-[12.5px] text-n-7">
                  <span className="font-semibold text-n-9">{area.name}</span> — {area.improvementCopy}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[12.5px] text-n-6">전 영역이 고르게 나타납니다.</p>
      )}

      <PrintButton />

      <Link href="/my" className="print-hide text-center text-[12px] font-semibold text-pink">
        마이페이지에서 다시 보기
      </Link>
    </div>
  );
}
