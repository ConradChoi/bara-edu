import type { Metadata } from 'next';
import CourseCard from '@/components/courses/CourseCard';
import FilterChip from '@/components/courses/FilterChip';
import { getActiveCategoryTree, getApprovedSeatsTaken, getPublicCourses } from '@/lib/supabase/queries';

export const metadata: Metadata = { title: '강좌안내 | 바라 평생교육원' };

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const categories = await getActiveCategoryTree();
  const topCategories = categories.filter((c) => c.depth === 1);
  const courses = await getPublicCourses(category);
  const seatsTaken = await getApprovedSeatsTaken(courses.map((c) => c.id));

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-10">
      <h1 className="text-[24px] font-semibold text-n-9">강좌안내</h1>

      <nav className="mt-6 flex flex-wrap gap-2">
        <FilterChip label="전체" href="/courses" active={!category} />
        {topCategories.map((c) => (
          <FilterChip key={c.id} label={c.name} href={`/courses?category=${c.id}`} active={category === c.id} />
        ))}
      </nav>

      {courses.length === 0 ? (
        <p className="mt-16 text-center text-[13px] text-n-6">조건에 맞는 강좌가 없어요</p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => {
            const categoryName = categories.find((c) => c.id === course.categoryId)?.name;
            const isFull = (seatsTaken[course.id] ?? 0) >= course.seats;

            return <CourseCard key={course.id} course={course} categoryName={categoryName} isFull={isFull} />;
          })}
        </div>
      )}
    </div>
  );
}
