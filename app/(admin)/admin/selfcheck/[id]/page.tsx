import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import StatusBadge from '@/components/admin/StatusBadge';
import { DIAGNOSIS_AREAS, DIAGNOSIS_LEARNING_EXPERIENCE_LABELS, DIAGNOSIS_TIER_LABELS } from '@/data/diagnosis/config';
import { getAdminDiagnosisResultDetail } from '@/lib/supabase/admin-queries';

export const metadata: Metadata = { title: '진단 결과 상세 | 관리자' };

// F-ADMDG-2. 상세는 항상 원문(마스킹 없음)으로 보여주고, 열람 시점에 admin_access_logs에
// 기록한다(getAdminDiagnosisResultDetail 내부에서 처리) — 회원 상세(getAdminMemberDetail)와
// 동일한 원칙: 이미 특정 레코드를 열어보기로 한 행위 자체가 의도적 조회라 목록의
// "개인정보 보기" 같은 별도 확인 없이 로그만 남긴다.
export default async function AdminDiagnosisResultDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getAdminDiagnosisResultDetail(id);
  if (!detail) notFound();

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
          {detail.respondentName} · {detail.phone} · {detail.email}
        </p>
        <p className="text-[12px] text-n-6">
          {DIAGNOSIS_LEARNING_EXPERIENCE_LABELS[detail.learningExperience] ?? detail.learningExperience} · 제출{' '}
          {new Date(detail.createdAt).toLocaleString('ko-KR')}
        </p>
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
