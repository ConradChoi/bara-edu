import type { Metadata } from 'next';
import Link from 'next/link';
import AdminTable from '@/components/admin/AdminTable';
import StatusBadge from '@/components/admin/StatusBadge';
import { formatKstDisplay } from '@/lib/kst';
import {
  getAdminDashboardStats,
  getNearCompletionLearners,
  getOverCapacityCourses,
  getRecentSignups,
  getSignupSummary,
  getSignupTrend,
  getUnconfirmedMemberStats,
} from '@/lib/supabase/admin-queries';

export const metadata: Metadata = { title: '대시보드 | 관리자' };

// 클릭 가능한 카드(Link) 공통 스타일 — hover/focus 상태가 원래 스펙에 없었어서
// ui-ux-designer 검토(2026-09-09)에서 추가한 것. 클릭 안 되는 미인증 카드와
// 정지 상태에서 구분이 안 됐던 문제를 hover 반응 유무로 해소한다.
const CARD_LINK_CLASS =
  'rounded-lg border border-n-3 bg-n-0 p-4 transition hover:border-indigo/40 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo';

export default async function AdminDashboardPage() {
  // getRecentSignups/getUnconfirmedMemberStats는 service_role admin API(auth.admin.listUsers)에
  // 의존해 나머지 쿼리보다 실패 가능성이 높다 — 하나의 Promise.all에 묶으면 이 둘의 실패가
  // 신청/입금 등 기존 핵심 카드까지 함께 무너뜨린다. 별도 allSettled로 격리해 실패해도
  // 나머지 대시보드는 정상 렌더링되도록 한다(qa-reviewer 지적, 2026-09-09).
  const [[stats, overCapacity, nearCompletion, signupSummary, signupTrend], [recentSignupsResult, unconfirmedResult]] =
    await Promise.all([
      Promise.all([getAdminDashboardStats(), getOverCapacityCourses(), getNearCompletionLearners(), getSignupSummary(), getSignupTrend()]),
      Promise.allSettled([getRecentSignups(), getUnconfirmedMemberStats()]),
    ]);

  const recentSignups = recentSignupsResult.status === 'fulfilled' ? recentSignupsResult.value : [];
  const recentSignupsFailed = recentSignupsResult.status === 'rejected';
  const unconfirmed = unconfirmedResult.status === 'fulfilled' ? unconfirmedResult.value : { total: 0, staleOver7Days: 0 };
  const unconfirmedFailed = unconfirmedResult.status === 'rejected';

  const enrollmentCards = [
    { label: '신규 신청 (오늘)', value: stats.newApplicationsToday, href: '/admin/enrollments' },
    { label: '입금 대기', value: stats.paymentPendingTotal, href: '/admin/enrollments?status=pending' },
    { label: '오늘 승인', value: stats.approvedToday, href: '/admin/enrollments?status=approved' },
    { label: '수료 임박', value: nearCompletion.length, href: '/admin/certificates' },
  ];

  const maxTrendCount = Math.max(1, ...signupTrend.map((p) => p.count));
  const hasSignupsInTrend = signupTrend.some((p) => p.count > 0);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[20px] font-semibold text-n-9">대시보드</h1>

      <section className="flex flex-col gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-n-5">신청·수료</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {enrollmentCards.map((c) => (
            <Link key={c.label} href={c.href} className={CARD_LINK_CLASS}>
              <p className="text-[12px] text-n-6">{c.label}</p>
              <p className="mt-1 text-[24px] font-semibold text-n-9">{c.value}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-n-5">회원 가입</p>
          <p className="text-[11px] text-n-5">가입 시도 기준 · 이메일 미인증·탈퇴 회원 포함(아래 최근 가입자 목록은 탈퇴 회원 제외)</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link href="/admin/members" className={CARD_LINK_CLASS}>
            <p className="text-[12px] text-n-6">오늘 신규가입</p>
            <p className="mt-1 text-[24px] font-semibold text-n-9">{signupSummary.todayCount}</p>
          </Link>
          <Link href="/admin/members" className={CARD_LINK_CLASS}>
            <p className="text-[12px] text-n-6">이번주 신규가입</p>
            <p className="mt-1 text-[24px] font-semibold text-n-9">{signupSummary.weekCount}</p>
            <p className="mt-0.5 text-[11px] text-n-5">{signupSummary.weekRangeLabel}</p>
          </Link>
          <div className="rounded-lg border border-n-3 bg-n-0 p-4">
            <p className="text-[12px] text-n-6">이메일 미인증 회원</p>
            <p className="mt-1 text-[24px] font-semibold text-n-9">{unconfirmedFailed ? '-' : unconfirmed.total}</p>
            <p className="mt-0.5 text-[11px] font-medium text-warning">
              {unconfirmedFailed
                ? '일시적으로 확인할 수 없어요'
                : `${unconfirmed.staleOver7Days > 0 ? `7일 초과 방치 ${unconfirmed.staleOver7Days}명 · ` : ''}개별 목록은 추후 제공 예정`}
            </p>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold text-n-9">가입 추이 (최근 30일)</h2>
        {hasSignupsInTrend ? (
          <div className="rounded-lg border border-n-3 bg-n-0 p-4">
            <div className="flex h-28 items-end gap-[3px]">
              {signupTrend.map((p) => (
                <div
                  key={p.date}
                  title={`${p.date} · ${p.count}명`}
                  className="min-h-[2px] flex-1 rounded-t-sm bg-indigo/70 transition hover:bg-indigo"
                  style={{ height: `${(p.count / maxTrendCount) * 100}%` }}
                />
              ))}
            </div>
            <div className="mt-1.5 flex text-[10.5px] text-n-5">
              {signupTrend.map((p, i) => (
                <span key={p.date} className="flex-1 text-center">
                  {i % 5 === 0 || i === signupTrend.length - 1 ? p.date.slice(5).replace('-', '/') : ''}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-n-6">최근 30일간 신규 가입이 없어요.</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold text-n-9">최근 가입자</h2>
        {recentSignupsFailed ? (
          <p className="text-[13px] text-n-6">최근 가입자 정보를 일시적으로 불러올 수 없어요.</p>
        ) : recentSignups.length === 0 ? (
          <p className="text-[13px] text-n-6">가입한 회원이 없어요.</p>
        ) : (
          <AdminTable>
            <thead>
              <tr>
                <th>이름</th>
                <th>이메일</th>
                <th>가입일시</th>
                <th>인증상태</th>
              </tr>
            </thead>
            <tbody>
              {recentSignups.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/admin/members/${r.id}`} className="font-medium text-n-9">
                      {r.name}
                    </Link>
                  </td>
                  <td className="font-mono text-n-6">{r.maskedEmail}</td>
                  <td className="text-n-6">{formatKstDisplay(r.createdAt)}</td>
                  <td>
                    {r.confirmed === null ? (
                      <StatusBadge tone="neutral">확인 불가</StatusBadge>
                    ) : (
                      <StatusBadge tone={r.confirmed ? 'success' : 'warning'}>{r.confirmed ? '인증완료' : '미인증'}</StatusBadge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </section>

      {overCapacity.length > 0 && (
        <section className="rounded-lg border border-warning bg-warning/10 p-4">
          <h2 className="text-[13px] font-semibold text-warning">정원 초과 강좌 {overCapacity.length}건</h2>
          <ul className="mt-2 flex flex-col gap-1 text-[12.5px] text-n-7">
            {overCapacity.map((c) => (
              <li key={c.courseId}>
                <Link href={`/admin/courses/${c.courseId}`} className="underline">
                  {c.title}
                </Link>{' '}
                — {c.approvedCount}/{c.seats}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold text-n-9">수료 임박 학습자</h2>
        <p className="text-[12px] text-n-5">진도 80% 이상, 미발급 기준. 강의실(module-lms-5) 도입 전까지는 비어있는 게 정상이에요.</p>
        {nearCompletion.length === 0 ? (
          <p className="text-[13px] text-n-6">대상자가 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {nearCompletion.map((l) => (
              <li
                key={`${l.userId}-${l.courseId}`}
                className="flex items-center justify-between rounded-lg border border-n-3 p-3 text-[13px]"
              >
                <span>
                  <span className="font-medium text-n-9">{l.userName}</span> · {l.courseTitle}
                </span>
                <span className="text-n-6">
                  {l.completedLessons}/{l.totalLessons} ({Math.round(l.ratio * 100)}%)
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
