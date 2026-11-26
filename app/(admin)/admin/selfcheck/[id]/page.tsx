import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import StatusBadge from '@/components/admin/StatusBadge';
import { DIAGNOSIS_AREAS, DIAGNOSIS_LEARNING_EXPERIENCE_LABELS, DIAGNOSIS_TIER_LABELS } from '@/data/diagnosis/config';
import { redirect } from 'next/navigation';
import { ADMIN_DIAGNOSIS_COPY, fill } from '@/data/diagnosis/consent-copy';
import { getDiagnosisResultDetailApi, type DiagnosisResultDetail } from '@/lib/db/admin-diagnosis';
import { formatKstDatetimeLocal } from '@/lib/kst';

export const metadata: Metadata = { title: '진단 결과 상세 | 관리자' };

// F-ADMDG-2. 상세는 항상 원문(마스킹 없음)으로 보여주되, 접속기록(admin_access_logs '조회')이 남은 경우에만 그렇다.
// 조회와 기록을 API가 한 트랜잭션으로 처리하고, 기록이 실패하면 원문 없이 오류만 돌려준다 — 이 화면은 그때
// 개인정보·응답을 하나도 그리지 않고 안내만 보여 준다(처리방침 제8조 제5항, 2026-11-26).
export default async function AdminDiagnosisResultDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getDiagnosisResultDetailApi(id);
  if (!res.ok) {
    if (res.reason === 'not_found') notFound();
    if (res.reason === 'unauthenticated') redirect('/sign-in');
    return (
      <div className="flex max-w-[640px] flex-col gap-5">
        <Link href="/admin/selfcheck" className="text-[12px] text-n-6">
          ← 목록으로
        </Link>
        <h1 className="text-[19px] font-semibold text-n-9">진단 결과 상세</h1>
        <div role="alert" className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-n-9">
          {res.reason === 'log_failed'
            ? '접속 기록을 남기지 못해 이 결과를 열지 않았어요. 개인정보 보호를 위해 기록이 남아야 볼 수 있어요. 잠시 후 다시 시도해 주세요.'
            : res.reason === 'forbidden'
              ? '이 결과를 볼 권한이 없어요.'
              : '결과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'}
        </div>
      </div>
    );
  }
  const detail = res.detail;

  const scores: Record<string, number> = {
    theory: detail.scoreTheory,
    reading: detail.scoreReading,
    analysis: detail.scoreAnalysis,
    counseling: detail.scoreCounseling,
    case_record: detail.scoreCaseRecord,
    teaching: detail.scoreTeaching,
  };

  return (
    <div className="flex max-w-[640px] flex-col gap-5">
      <Link href="/admin/selfcheck" className="text-[12px] text-n-6">
        ← 목록으로
      </Link>
      <h1 className="text-[19px] font-semibold text-n-9">진단 결과 상세</h1>

      <div className="flex flex-col gap-1 rounded-lg bg-n-1 p-4">
        <p className="text-[13px] font-semibold text-n-9">
          {[detail.respondentName, detail.phone, detail.email].filter(Boolean).join(' · ') || '(파기됨)'}
        </p>
        <p className="text-[12px] text-n-6">
          {DIAGNOSIS_LEARNING_EXPERIENCE_LABELS[detail.learningExperience] ?? detail.learningExperience} · 제출{' '}
          {new Date(detail.createdAt).toLocaleString('ko-KR')}
        </p>
        <ConsentRecord detail={detail} />
        <div className="mt-1 flex items-center gap-2">
          <StatusBadge tone="info">
            {DIAGNOSIS_TIER_LABELS[detail.recommendedTier as keyof typeof DIAGNOSIS_TIER_LABELS] ?? detail.recommendedTier}
          </StatusBadge>
          {detail.userId ? (
            <Link href={`/admin/members/${detail.userId}`} className="text-[12px] font-medium text-indigo underline">
              회원 상세로 이동 →
            </Link>
          ) : (
            <StatusBadge tone="neutral">비회원</StatusBadge>
          )}
        </div>
      </div>

      <p className="text-[14px] font-semibold text-n-9">6영역 점수</p>
      <div className="flex flex-col gap-2.5">
        {DIAGNOSIS_AREAS.map((area) => (
          <div key={area.code} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-n-9">{area.name}</span>
              <span className="font-semibold text-n-9">{scores[area.dbKey]}점</span>
            </div>
            <div className="h-2 w-full rounded-full bg-n-2">
              <div className="h-2 rounded-full bg-pink" style={{ width: `${Math.max(0, Math.min(100, scores[area.dbKey]))}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {detail.strengthAreas.map((code) => {
          const area = DIAGNOSIS_AREAS.find((a) => a.dbKey === code);
          return (
            <StatusBadge key={`s-${code}`} tone="success">
              강점 · {area?.name ?? code}
            </StatusBadge>
          );
        })}
        {detail.improvementAreas.map((code) => {
          const area = DIAGNOSIS_AREAS.find((a) => a.dbKey === code);
          return (
            <StatusBadge key={`i-${code}`} tone="warning">
              보완 · {area?.name ?? code}
            </StatusBadge>
          );
        })}
      </div>

      <p className="text-[14px] font-semibold text-n-9">응답 원본 (30문항)</p>
      <div className="rounded-lg border border-n-3 p-3.5">
        <p className="text-[11.5px] leading-relaxed text-n-6">
          {detail.answers.map((a) => `${a.itemCode}:${a.score}`).join('  ')}
        </p>
        <p className="mt-2 text-[10.5px] text-n-5">관리자 전용 — 학습자 화면에는 노출되지 않아요.</p>
      </div>

      <p className="text-[10.5px] text-n-5">이 화면 열람은 admin_access_logs에 기록됩니다.</p>
    </div>
  );
}

// 동의 기록 줄(SC-ADM-CONSENT-*, API 계약 C5). 시각은 한국 시간 YYYY-MM-DD HH:mm. 동의 기록은 고칠 수 없다(표시만).
function ConsentRecord({ detail }: { detail: DiagnosisResultDetail }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-n-7">
      <span className="font-semibold text-n-9">{ADMIN_DIAGNOSIS_COPY.consentLabel}</span>
      {detail.sensitiveConsentVersion ? (
        <span>{consentValue(detail)}</span>
      ) : (
        <StatusBadge tone="warning">{ADMIN_DIAGNOSIS_COPY.consentNone}</StatusBadge>
      )}
    </p>
  );
}

function consentValue(detail: DiagnosisResultDetail): string {
  const base = fill(ADMIN_DIAGNOSIS_COPY.consentValue, {
    version: detail.sensitiveConsentVersion ?? '',
    datetime: formatKstDatetimeLocal(detail.sensitiveConsentedAt).replace('T', ' ') || '-',
    n: detail.privacyDocVersion ?? '',
  });
  if (detail.privacyDocVersion !== null) return base;
  // 처리방침 버전이 없으면 "처리방침 v{n}" 자리를 SC-ADM-CONSENT-NODOC로 바꾼다.
  return base.replace(/처리방침 v$/, ADMIN_DIAGNOSIS_COPY.consentNoDoc);
}
