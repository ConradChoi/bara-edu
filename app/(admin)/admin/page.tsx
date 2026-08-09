import type { Metadata } from 'next';
import Link from 'next/link';
import {
  getAdminDashboardStats,
  getNearCompletionLearners,
  getOverCapacityCourses,
} from '@/lib/supabase/admin-queries';

export const metadata: Metadata = { title: '대시보드 | 관리자' };

export default async function AdminDashboardPage() {
  const [stats, overCapacity, nearCompletion] = await Promise.all([
    getAdminDashboardStats(),
    getOverCapacityCourses(),
    getNearCompletionLearners(),
  ]);

  const cards = [
    { label: '신규 신청 (오늘)', value: stats.newApplicationsToday, href: '/admin/enrollments' },
    { label: '입금 대기', value: stats.paymentPendingTotal, href: '/admin/enrollments?status=pending' },
    { label: '오늘 승인', value: stats.approvedToday, href: '/admin/enrollments?status=approved' },
    { label: '수료 임박', value: nearCompletion.length, href: '/admin/certificates' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[20px] font-semibold text-n-9">대시보드</h1>

      <div className="grid grid-cols-4 gap-3">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="rounded-lg border border-n-3 bg-n-0 p-4">
            <p className="text-[12px] text-n-6">{c.label}</p>
            <p className="mt-1 text-[24px] font-semibold text-n-9">{c.value}</p>
          </Link>
        ))}
      </div>

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
