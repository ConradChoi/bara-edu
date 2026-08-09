import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import PaymentGuide from '@/components/enrollment/PaymentGuide';
import {
  getApprovedSeatsTaken,
  getCategoryTree,
  getCourseBySlug,
  getMyEnrollmentForCourse,
} from '@/lib/supabase/queries';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const course = await getCourseBySlug(slug);
  return { title: course ? `${course.title} | 바라 평생교육원` : '강좌를 찾을 수 없어요 | 바라 평생교육원' };
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = await getCourseBySlug(slug);
  if (!course) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [categories, seatsTaken, myEnrollment] = await Promise.all([
    getCategoryTree(),
    getApprovedSeatsTaken([course.id]),
    user ? getMyEnrollmentForCourse(user.id, course.id) : Promise.resolve(null),
  ]);

  const categoryName = categories.find((c) => c.id === course.categoryId)?.name;
  const isFull = (seatsTaken[course.id] ?? 0) >= course.seats;
  const isLoggedIn = Boolean(user);

  return (
    <div className="mx-auto max-w-[720px] px-6 py-10">
      <div className="flex items-center gap-2">
        {categoryName && (
          <span className="rounded-pill bg-n-2 px-2.5 py-1 text-[11px] font-semibold text-n-7">{categoryName}</span>
        )}
        {course.governmentSupport && (
          <span className="rounded-pill bg-info/15 px-2.5 py-1 text-[11px] font-semibold text-info">정부지원</span>
        )}
        {course.status === 'upcoming' && (
          <span className="rounded-pill bg-warning/15 px-2.5 py-1 text-[11px] font-semibold text-warning">
            개강예정
          </span>
        )}
        {isFull && (
          <span className="rounded-pill bg-danger/15 px-2.5 py-1 text-[11px] font-semibold text-danger">마감</span>
        )}
      </div>

      <h1 className="mt-4 text-[24px] font-semibold text-n-9">{course.title}</h1>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-n-7">
        <div className="flex gap-1.5">
          <dt className="text-n-5">강사</dt>
          <dd>{course.instructor}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-n-5">수강료</dt>
          <dd className="font-semibold text-indigo">{course.fee.toLocaleString('ko-KR')}원</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-n-5">정원</dt>
          <dd>{course.seats}명</dd>
        </div>
      </dl>

      <p className="mt-6 whitespace-pre-line text-[14px] leading-relaxed text-n-7">{course.description}</p>

      <div className="mt-10 flex flex-col gap-2 border-t border-n-3 pt-6">
        {myEnrollment?.status === 'approved' ? (
          <Link
            href={`/learn/${course.id}`}
            className="flex h-[46px] items-center justify-center rounded-pill bg-pink text-[14px] font-semibold text-white"
          >
            강의실 입장
          </Link>
        ) : myEnrollment?.status === 'pending' ? (
          <PaymentGuide paymentDueAt={myEnrollment.paymentDueAt} />
        ) : isFull ? (
          <>
            <button
              type="button"
              disabled
              className="h-[46px] rounded-pill bg-n-3 text-[14px] font-semibold text-n-6 disabled:cursor-not-allowed"
            >
              수강 신청하기
            </button>
            <p className="text-center text-[12px] text-n-6">정원이 마감되었어요. 다른 강좌도 둘러보세요.</p>
          </>
        ) : isLoggedIn ? (
          <>
            <Link
              href={`/courses/${course.slug}/apply`}
              className="flex h-[46px] items-center justify-center rounded-pill bg-pink text-[14px] font-semibold text-white"
            >
              수강 신청하기
            </Link>
            {(myEnrollment?.status === 'rejected' || myEnrollment?.status === 'expired') && (
              <p className="text-center text-[12px] text-n-6">
                {myEnrollment.status === 'rejected' ? '반려된 신청이에요. 다시 신청할 수 있어요.' : '입금 기한이 지났어요. 다시 신청할 수 있어요.'}
              </p>
            )}
          </>
        ) : (
          <Link
            href={`/sign-in?redirect=/courses/${course.slug}`}
            className="flex h-[46px] items-center justify-center rounded-pill bg-pink text-[14px] font-semibold text-white"
          >
            로그인하고 신청하기
          </Link>
        )}
      </div>
    </div>
  );
}
