import type { Metadata } from 'next';
import Link from 'next/link';
import { getApprovedSeatsTaken, getCategoryTree, getPublicCourses } from '@/lib/supabase/queries';

export const metadata: Metadata = { title: '강좌안내 | 바라 평생교육원' };

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const categories = await getCategoryTree();
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

            return (
              <Link
                key={course.id}
                href={`/courses/${course.slug}`}
                className="flex flex-col gap-3 rounded-lg border border-n-3 bg-n-0 p-5 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  {categoryName && <Badge tone="neutral">{categoryName}</Badge>}
                  {course.governmentSupport && <Badge tone="info">정부지원</Badge>}
                  {isFull && <Badge tone="danger">마감</Badge>}
                </div>
                <h2 className="text-[16px] font-semibold text-n-9">{course.title}</h2>
                <p className="line-clamp-2 text-[13px] text-n-6">{course.description}</p>
                <div className="mt-auto flex items-center justify-between text-[13px] text-n-7">
                  <span>{course.instructor}</span>
                  <span className="font-semibold text-indigo">{course.fee.toLocaleString('ko-KR')}원</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-pill border px-3.5 py-1.5 text-[12.5px] font-medium transition ${
        active ? 'border-pink bg-pink text-white' : 'border-n-3 bg-n-0 text-n-7 hover:border-pink hover:text-pink'
      }`}
    >
      {label}
    </Link>
  );
}

function Badge({ tone, children }: { tone: 'neutral' | 'info' | 'danger'; children: React.ReactNode }) {
  const toneClass = {
    neutral: 'bg-n-2 text-n-7',
    info: 'bg-info/15 text-info',
    danger: 'bg-danger/15 text-danger',
  }[tone];

  return <span className={`rounded-pill px-2.5 py-1 text-[11px] font-semibold ${toneClass}`}>{children}</span>;
}
