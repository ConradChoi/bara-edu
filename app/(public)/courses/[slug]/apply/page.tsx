import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { applyToCourse } from '@/app/actions/enrollment';
import { getApprovedSeatsTaken, getCourseBySlug, getMyEnrollmentForCourse } from '@/lib/supabase/queries';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: '신청 확인 | 바라 평생교육원' };

export default async function ApplyConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const course = await getCourseBySlug(slug);
  if (!course) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?redirect=/courses/${slug}/apply`);

  const [seatsTaken, myEnrollment] = await Promise.all([
    getApprovedSeatsTaken([course.id]),
    getMyEnrollmentForCourse(user.id, course.id),
  ]);
  const isFull = (seatsTaken[course.id] ?? 0) >= course.seats;
  const isActive = myEnrollment?.status === 'approved' || myEnrollment?.status === 'pending';

  // 마감됐거나 이미 신청/수강 중이면 상세 화면(마감 배지, 입금 안내 등)으로 돌려보낸다.
  if (isFull || isActive) redirect(`/courses/${slug}`);

  return (
    <div className="mx-auto max-w-[480px] px-6 py-10">
      <h1 className="text-[20px] font-semibold text-n-9">신청 확인</h1>

      <div className="mt-6 flex flex-col gap-2 rounded-lg border border-n-3 bg-n-1 p-5 text-[13px]">
        <div className="flex justify-between">
          <span className="text-n-6">강좌명</span>
          <span className="font-medium text-n-9">{course.title}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-n-6">수강료</span>
          <span className="font-semibold text-indigo">{course.fee.toLocaleString('ko-KR')}원</span>
        </div>
      </div>

      {error === 'agree-required' && (
        <p className="mt-3 text-[12.5px] text-danger">약관에 동의해야 신청할 수 있어요</p>
      )}
      {error === 'conflict' && (
        <p className="mt-3 text-[12.5px] text-danger">처리 중 문제가 발생했어요. 신청 현황을 확인한 뒤 다시 시도해주세요.</p>
      )}

      <form action={applyToCourse.bind(null, course.id, slug)} className="mt-6 flex flex-col gap-4">
        <label className="flex items-center gap-2 text-[12.5px] text-n-7">
          <input type="checkbox" name="agree" required className="h-4 w-4" />
          <Link href="/legal/terms" target="_blank" className="underline">
            이용약관
          </Link>
          {' '}및{' '}
          <Link href="/legal/privacy" target="_blank" className="underline">
            개인정보처리방침
          </Link>
          에 동의합니다
        </label>
        <div className="flex gap-2">
          <Link
            href={`/courses/${slug}`}
            className="flex h-[46px] flex-1 items-center justify-center rounded-pill border border-n-3 text-[14px] font-medium text-n-7"
          >
            취소
          </Link>
          <button type="submit" className="h-[46px] flex-1 rounded-pill bg-pink text-[14px] font-semibold text-white">
            신청 확정
          </button>
        </div>
      </form>
    </div>
  );
}
