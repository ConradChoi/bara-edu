import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Badge from '@/components/courses/Badge';
import PaymentGuide from '@/components/enrollment/PaymentGuide';
import { formatDateRangeDisplay } from '@/lib/kst';
import {
  getActiveCategoryTree,
  getApprovedSeatsTaken,
  getCourseBySlug,
  getCourseMaterialsForCourse,
  getMyEnrollmentForCourse,
  getPublicLessonsForCourse,
} from '@/lib/supabase/queries';
import { createClient } from '@/lib/supabase/server';
import type { CourseScheduleType, LessonMode } from '@/lib/types';

const LESSON_MODE_LABEL: Record<LessonMode, string> = { video: '영상', online: '온라인', offline: '오프라인' };
const SCHEDULE_TYPE_LABEL: Record<CourseScheduleType, string> = { weekday: '평일반', weekend: '주말반', both: '평일+주말반' };

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

  const [categories, seatsTaken, myEnrollment, lessons, materials] = await Promise.all([
    getActiveCategoryTree(),
    getApprovedSeatsTaken([course.id]),
    user ? getMyEnrollmentForCourse(user.id, course.id) : Promise.resolve(null),
    getPublicLessonsForCourse(course.id),
    getCourseMaterialsForCourse(course.id),
  ]);

  const mainMaterial = materials.find((m) => m.kind === 'main');
  const supplementaryMaterials = materials.filter((m) => m.kind === 'supplementary');

  const categoryName = categories.find((c) => c.id === course.categoryId)?.name;
  const isFull = (seatsTaken[course.id] ?? 0) >= course.seats;
  const isLoggedIn = Boolean(user);

  return (
    <div className="mx-auto max-w-[720px] px-6 py-10">
      <div className="flex items-center gap-2">
        {categoryName && <Badge tone="neutral">{categoryName}</Badge>}
        {course.governmentSupport && <Badge tone="info">정부지원</Badge>}
        {course.scheduleType && <Badge tone="neutral">{SCHEDULE_TYPE_LABEL[course.scheduleType]}</Badge>}
        {course.status === 'upcoming' && <Badge tone="warning">개강예정</Badge>}
        {isFull && <Badge tone="danger">마감</Badge>}
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
        {course.totalHours != null && (
          <div className="flex gap-1.5">
            <dt className="text-n-5">총 강좌 시간</dt>
            <dd>{course.totalHours}시간</dd>
          </div>
        )}
        {formatDateRangeDisplay(course.startDate, course.endDate) && (
          <div className="flex gap-1.5">
            <dt className="text-n-5">수강 기간</dt>
            <dd>{formatDateRangeDisplay(course.startDate, course.endDate)}</dd>
          </div>
        )}
      </dl>

      <p className="mt-6 whitespace-pre-line text-[14px] leading-relaxed text-n-7">{course.description}</p>

      {lessons.length > 0 && (
        <div className="mt-8 flex flex-col gap-2">
          <h2 className="text-[15px] font-semibold text-n-9">커리큘럼</h2>
          <ul className="flex flex-col gap-2">
            {lessons.map((lesson, index) => (
              <li
                key={lesson.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-n-3 bg-n-0 p-3 text-[13px]"
              >
                <span className="text-n-5">{index + 1}강</span>
                <span className="flex-1 font-medium text-n-9">{lesson.title}</span>
                <Badge tone="neutral">{LESSON_MODE_LABEL[lesson.lessonMode]}</Badge>
                {lesson.hasQuiz && <Badge tone="info">퀴즈</Badge>}
                {lesson.hasAssignment && <Badge tone="info">과제</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(mainMaterial || supplementaryMaterials.length > 0) && (
        <div className="mt-8 flex flex-col gap-2">
          <h2 className="text-[15px] font-semibold text-n-9">교재</h2>
          <ul className="flex flex-col gap-2">
            {mainMaterial && (
              <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-n-3 bg-n-0 p-3 text-[13px]">
                <Badge tone="info">주교재</Badge>
                <span className="flex-1 font-medium text-n-9">{mainMaterial.title}</span>
                {mainMaterial.publisher && <span className="text-n-5">{mainMaterial.publisher}</span>}
                {mainMaterial.purchaseUrl && (
                  <a
                    href={mainMaterial.purchaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12.5px] font-medium text-indigo underline"
                  >
                    구매하기
                  </a>
                )}
              </li>
            )}
            {supplementaryMaterials.map((material) => (
              <li
                key={material.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-n-3 bg-n-0 p-3 text-[13px]"
              >
                <Badge tone="neutral">보조교재</Badge>
                <span className="flex-1 font-medium text-n-9">{material.title}</span>
                {material.publisher && <span className="text-n-5">{material.publisher}</span>}
                {material.purchaseUrl && (
                  <a
                    href={material.purchaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12.5px] font-medium text-indigo underline"
                  >
                    구매하기
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
