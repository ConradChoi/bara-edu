import type { Metadata } from 'next';
import Link from 'next/link';
import { withdraw } from '@/app/actions/account';
import WithdrawForm from '@/components/mypage/WithdrawForm';
import {
  getCompletedEnrollmentsForUser,
  getMyCertificatesWithCourse,
  getProgressStatsForCourses,
} from '@/lib/supabase/classroom-queries';
import { getMyEnrollments, type MyEnrollment } from '@/lib/supabase/queries';
import { createClient } from '@/lib/supabase/server';
import type { EnrollmentStatus } from '@/lib/types';

export const metadata: Metadata = { title: '마이페이지 | 바라 평생교육원' };

const TABS = [
  { key: 'applications', label: '신청내역' },
  { key: 'in-progress', label: '수강중' },
  { key: 'completed', label: '완료' },
  { key: 'certificates', label: '수료증' },
] as const;

const STATUS_LABEL: Record<EnrollmentStatus, string> = {
  pending: '대기',
  approved: '승인',
  rejected: '반려',
  expired: '만료',
};

const STATUS_TONE: Record<EnrollmentStatus, string> = {
  pending: 'bg-warning/15 text-warning',
  approved: 'bg-success/15 text-success',
  rejected: 'bg-danger/15 text-danger',
  expired: 'bg-n-2 text-n-6',
};

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; withdrawError?: string }>;
}) {
  const { tab = 'applications', withdrawError } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // proxy.ts가 비로그인 접근을 이미 차단한다

  const enrollments = await getMyEnrollments(user.id);
  const inProgress = enrollments.filter((e) => e.status === 'approved');
  const progressStats = await getProgressStatsForCourses(
    user.id,
    inProgress.map((e) => e.courseId)
  );
  const completed = tab === 'completed' ? await getCompletedEnrollmentsForUser(user.id) : [];
  const certificates = tab === 'certificates' ? await getMyCertificatesWithCourse(user.id) : [];

  return (
    <div className="mx-auto max-w-[800px] px-6 py-10">
      <h1 className="text-[24px] font-semibold text-n-9">마이페이지</h1>

      {withdrawError === 'active-enrollment' && (
        <div className="mt-4 rounded-md border border-warning bg-warning/10 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-warning">진행 중인 강좌가 있어 탈퇴할 수 없어요.</p>
          <p className="text-[12px] text-n-7">고객센터로 문의해 주세요.</p>
        </div>
      )}
      {withdrawError === 'failed' && (
        <div className="mt-4 rounded-md border border-danger bg-danger/10 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-danger">탈퇴 처리 중 문제가 발생했어요.</p>
          <p className="text-[12px] text-n-7">잠시 후 다시 시도하거나 고객센터로 문의해 주세요.</p>
        </div>
      )}

      <nav className="mt-6 flex gap-1 border-b border-n-3">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/my?tab=${t.key}`}
            className={`px-4 py-2.5 text-[13px] font-medium ${
              tab === t.key ? 'border-b-2 border-pink text-pink' : 'text-n-6'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === 'in-progress' ? (
          <EnrollmentList
            enrollments={inProgress}
            emptyMessage="수강 중인 강좌가 없어요"
            showStatus={false}
            progressStats={progressStats}
          />
        ) : tab === 'completed' ? (
          completed.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-n-6">아직 완료한 강좌가 없어요</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {completed.map((c) => (
                <li key={c.courseId} className="flex items-center justify-between rounded-lg border border-n-3 p-4">
                  <Link href={`/courses/${c.courseSlug}`} className="text-[14px] font-semibold text-n-9">
                    {c.courseTitle}
                  </Link>
                  <Link href={`/learn/${c.courseId}`} className="rounded-pill border border-n-3 px-3 py-1.5 text-[12px] font-medium text-n-7">
                    다시 보기
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : tab === 'certificates' ? (
          certificates.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-n-6">아직 발급된 수료증이 없어요</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {certificates.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-lg border border-n-3 p-4">
                  <span className="text-[14px] font-semibold text-n-9">{c.courseTitle}</span>
                  <span className="text-[12px] text-n-6">{new Date(c.issuedAt).toLocaleDateString('ko-KR')} 발급</span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <EnrollmentList enrollments={enrollments} emptyMessage="신청한 강좌가 없어요" showStatus />
        )}
      </div>

      <div className="mt-16 flex items-center justify-between border-t border-n-3 pt-6">
        <span className="text-[12px] text-n-5">설정</span>
        <WithdrawForm action={withdraw} />
      </div>
    </div>
  );
}

function EnrollmentList({
  enrollments,
  emptyMessage,
  showStatus,
  progressStats,
}: {
  enrollments: MyEnrollment[];
  emptyMessage: string;
  showStatus: boolean;
  progressStats?: Record<string, { totalLessons: number; completedLessons: number }>;
}) {
  if (enrollments.length === 0) {
    return <p className="py-10 text-center text-[13px] text-n-6">{emptyMessage}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {enrollments.map((e) => {
        const stat = progressStats?.[e.courseId];
        const ratio = stat && stat.totalLessons > 0 ? Math.round((stat.completedLessons / stat.totalLessons) * 100) : 0;

        return (
          <li key={e.id} className="flex items-center justify-between rounded-lg border border-n-3 p-4">
            <div className="flex flex-col gap-1">
              <Link href={`/courses/${e.courseSlug}`} className="text-[14px] font-semibold text-n-9">
                {e.courseTitle}
              </Link>
              <span className="text-[12px] text-n-6">{e.fee.toLocaleString('ko-KR')}원</span>
              {e.status === 'rejected' && e.rejectionReason && (
                <p className="text-[11.5px] text-danger">사유: {e.rejectionReason}</p>
              )}
              {!showStatus && stat && <span className="text-[11.5px] text-n-6">진도 {ratio}%</span>}
            </div>
            {showStatus ? (
              <span className={`rounded-pill px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONE[e.status]}`}>
                {STATUS_LABEL[e.status]}
              </span>
            ) : (
              <Link
                href={`/learn/${e.courseId}`}
                className="rounded-pill bg-pink px-3 py-1.5 text-[12px] font-medium text-white"
              >
                강의실 입장
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
