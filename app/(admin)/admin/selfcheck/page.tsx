import type { Metadata } from 'next';
import Link from 'next/link';
import { hideDiagnosisResultContact, revealDiagnosisResultContact } from '@/app/actions/admin-diagnosis';
import AdminTable from '@/components/admin/AdminTable';
import StatusBadge from '@/components/admin/StatusBadge';
import { redirect } from 'next/navigation';
import { DIAGNOSIS_LEARNING_EXPERIENCE_LABELS, DIAGNOSIS_TIER_LABELS } from '@/data/diagnosis/config';
import { ADMIN_DIAGNOSIS_COPY } from '@/data/diagnosis/consent-copy';
import { getAdminDiagnosisResults } from '@/lib/supabase/admin-queries';

export const metadata: Metadata = { title: '진단 결과 조회 | 관리자' };

const TIER_FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'level2', label: '2급 추천' },
  { value: 'level1', label: '1급 추천' },
  { value: 'supervision', label: '실습·슈퍼비전' },
  { value: 'instructor_candidate', label: '강사과정 후보' },
];
const MEMBER_FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'member', label: '회원만' },
  { value: 'non_member', label: '비회원만' },
];

export default async function AdminDiagnosisResultsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tier?: string;
    memberOnly?: string;
    revealPii?: string;
    revealToken?: string;
    revealExp?: string;
    revealFailed?: string;
  }>;
}) {
  const { tier = 'all', memberOnly = 'all', revealPii, revealToken, revealExp, revealFailed } = await searchParams;
  // 이름·연락처는 API가 가려서 준다(홍**). [개인정보 보기]로 검증된 한 행만 원문 + 접속 기록(API 계약 C4).
  const page = await getAdminDiagnosisResults(
    { tier, memberOnly },
    { id: revealPii, token: revealToken, exp: revealExp ? Number(revealExp) : undefined }
  );
  if (!page.ok && page.reason === 'unauthenticated') redirect('/sign-in');
  const results = page.ok ? page.rows : [];

  function filterHref(nextTier: string, nextMemberOnly: string) {
    const params = new URLSearchParams();
    if (nextTier !== 'all') params.set('tier', nextTier);
    if (nextMemberOnly !== 'all') params.set('memberOnly', nextMemberOnly);
    const qs = params.toString();
    return qs ? `/admin/selfcheck?${qs}` : '/admin/selfcheck';
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[20px] font-semibold text-n-9">진단 결과 조회</h1>

      {page.ok && page.revealFailed && (
        <div role="alert" className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          접속 기록을 남기지 못해 개인정보를 보여 드리지 않았어요. 잠시 후 다시 시도해 주세요.
        </div>
      )}
      {!page.ok && (
        <div role="alert" className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          {page.reason === 'forbidden' ? '진단 결과를 볼 권한이 없어요.' : '진단 결과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'}
        </div>
      )}

      {revealFailed === '1' && (
        <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          개인정보 보기 처리 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요. 계속되면 관리자에게 문의해 주세요.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {TIER_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={filterHref(f.value, memberOnly)}
            className={`rounded-pill border px-3 py-1.5 text-[12px] font-medium ${
              tier === f.value ? 'border-pink bg-pink/10 text-pink' : 'border-n-3 text-n-7'
            }`}
          >
            {f.label}
          </Link>
        ))}
        <span className="mx-1 self-center text-n-3">|</span>
        {MEMBER_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={filterHref(tier, f.value)}
            className={`rounded-pill border px-3 py-1.5 text-[12px] font-medium ${
              memberOnly === f.value ? 'border-pink bg-pink/10 text-pink' : 'border-n-3 text-n-7'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <p className="text-[12px] text-n-7">{ADMIN_DIAGNOSIS_COPY.maskHint}</p>

      <AdminTable>
        <thead>
          <tr>
            <th>일시</th>
            <th>이름</th>
            <th>연락처</th>
            <th>학습경험</th>
            <th>전체점수</th>
            <th>추천 tier</th>
            <th>회원귀속</th>
            <th>개인정보</th>
          </tr>
        </thead>
        <tbody>
          {results.length === 0 ? (
            <tr>
              <td colSpan={8} className="py-10 text-center text-n-6">
                {page.ok ? '진단 결과가 없어요.' : '-'}
              </td>
            </tr>
          ) : (
            results.map((r) => (
              <tr key={r.id} className={r.isRevealed ? 'bg-warning/10' : undefined}>
                <td>{new Date(r.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>
                  <Link href={`/admin/selfcheck/${r.id}`} className="font-medium text-indigo underline-offset-2 hover:underline">
                    {r.respondentName}
                  </Link>
                </td>
                <td>
                  <div className="flex flex-col gap-0.5">
                    <span>{r.phone}</span>
                    <span className="text-n-5">{r.email}</span>
                  </div>
                </td>
                <td>{DIAGNOSIS_LEARNING_EXPERIENCE_LABELS[r.learningExperience] ?? r.learningExperience}</td>
                <td>{Math.round(r.totalScore)}점</td>
                <td>
                  <StatusBadge tone="info">{DIAGNOSIS_TIER_LABELS[r.recommendedTier as keyof typeof DIAGNOSIS_TIER_LABELS] ?? r.recommendedTier}</StatusBadge>
                </td>
                <td>{r.userId ? <StatusBadge tone="success">회원</StatusBadge> : <StatusBadge tone="neutral">비회원</StatusBadge>}</td>
                <td>
                  {r.isRevealed ? (
                    <form action={hideDiagnosisResultContact}>
                      <button type="submit" className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7">
                        가리기
                      </button>
                    </form>
                  ) : (
                    <form action={revealDiagnosisResultContact.bind(null, r.id)}>
                      <button type="submit" className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7">
                        개인정보 보기
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </AdminTable>

      <p className="text-[12px] text-n-6">
        &quot;개인정보 보기&quot;를 누르면 그 행의 이름·연락처 원문이 표시되고, 이 열람은 접속기록(admin_access_logs)에 남습니다.
      </p>
    </div>
  );
}
