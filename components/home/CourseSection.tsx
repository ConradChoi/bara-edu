import Link from 'next/link';
import CourseCard from '@/components/courses/CourseCard';
import { getActiveCategoryTree, getApprovedSeatsTaken, getPublicCourses } from '@/lib/supabase/queries';

export default async function CourseSection() {
  const [allCourses, categories] = await Promise.all([getPublicCourses(), getActiveCategoryTree()]);
  const courses = allCourses.slice(0, 6);
  const seatsTaken = await getApprovedSeatsTaken(courses.map((c) => c.id));

  return (
    <section className="w-full bg-n-1">
      <div className="mx-auto max-w-[1200px] px-5 py-14 md:px-6 md:py-20">
        <h2 className="text-center text-[22px] font-bold text-n-9 md:text-[28px]">지금 개설된 강좌</h2>
        <p className="mt-2 text-center text-[16px] text-n-6">최근에 열린 강좌부터 보여드려요.</p>

        {courses.length === 0 ? (
          <p className="mt-16 text-center text-[16px] text-n-6">강좌를 준비하고 있어요. 곧 새로운 소식으로 찾아뵐게요.</p>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-1 gap-5 md:mt-10 md:grid-cols-2 lg:grid-cols-3">
              {courses.map((course) => {
                const categoryName = categories.find((c) => c.id === course.categoryId)?.name;
                const isFull = (seatsTaken[course.id] ?? 0) >= course.seats;
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
