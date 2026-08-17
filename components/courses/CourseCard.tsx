import Link from 'next/link';
import Badge from '@/components/courses/Badge';
import type { Course } from '@/lib/types';

export default function CourseCard({
  course,
  categoryName,
  isFull,
}: {
  course: Course;
  categoryName?: string;
  isFull: boolean;
}) {
  return (
    <Link
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
}
