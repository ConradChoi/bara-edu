import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import CourseCard from '@/components/courses/CourseCard';
import { getActiveCategoryTree, getApprovedSeatsTaken, getPublicCourses } from '@/lib/supabase/queries';

type SectionData = {
  courses: Awaited<ReturnType<typeof getPublicCourses>>;
  categories: Awaited<ReturnType<typeof getActiveCategoryTree>>;
  seatsTaken: Awaited<ReturnType<typeof getApprovedSeatsTaken>>;
};

export default async function CourseSection() {
  // 조회 실패 시 홈 전체를 오류 화면으로 바꾸지 않고 이 섹션 안에서만 안내한다(home.md 11.7, QA Major-1, 2026-11-28).
  let data: SectionData | null = null;
  try {
    const [allCourses, categories] = await Promise.all([getPublicCourses(), getActiveCategoryTree()]);
    const courses = allCourses.slice(0, 6);
    const seatsTaken = await getApprovedSeatsTaken(courses.map((c) => c.id));
    data = { courses, categories, seatsTaken };
  } catch (err) {
    unstable_rethrow(err);
    console.error('[home] course section failed', err);
  }

  return (
    <section className="w-full bg-n-1">
      <div className="mx-auto max-w-[1200px] px-5 py-14 md:px-6 md:py-20">
        <h2 className="text-center text-[22px] font-bold text-n-9 md:text-[28px]">지금 개설된 강좌</h2>
        <p className="mt-2 text-center text-[16px] text-n-6">최근에 열린 강좌부터 보여드려요.</p>

        {data === null ? (
          <div className="mt-16 flex flex-col items-center gap-4">
            <p className="text-center text-[16px] text-n-6">강좌 목록을 잠시 불러오지 못했어요.</p>
            <Link
              href="/courses"
              className="inline-flex h-11 items-center justify-center rounded-pill border border-n-3 px-6 text-[14px] font-semibold text-indigo hover:border-indigo"
            >
              강좌안내에서 보기
            </Link>
          </div>
        ) : data.courses.length === 0 ? (
          <p className="mt-16 text-center text-[16px] text-n-6">강좌를 준비하고 있어요. 곧 새로운 소식으로 찾아뵐게요.</p>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-1 gap-5 md:mt-10 md:grid-cols-2 lg:grid-cols-3">
              {data.courses.map((course) => {
                const categoryName = data.categories.find((c) => c.id === course.categoryId)?.name;
                const isFull = (data.seatsTaken[course.id] ?? 0) >= course.seats;
                return <CourseCard key={course.id} course={course} categoryName={categoryName} isFull={isFull} />;
              })}
            </div>
            <div className="mt-10 flex justify-center">
              <Link
                href="/courses"
                className="inline-flex h-11 items-center justify-center rounded-pill border border-n-3 px-6 text-[14px] font-semibold text-indigo hover:border-indigo"
              >
                전체 강좌 보기
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
