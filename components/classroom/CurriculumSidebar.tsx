import Link from 'next/link';
import ProgressBar from '@/components/classroom/ProgressBar';
import type { Lesson } from '@/lib/types';

// F-LRN-1: 완료(✓)/진행중(▶)/예정(○) 표시, 자유 수강(Q4 — 잠금 없음).
// 모바일(390px)에서는 <details>로 접고 펼친다 — client JS 없이 순수 HTML로 처리.
export default function CurriculumSidebar({
  lessons,
  completedLessonIds,
  courseId,
  currentLessonId,
}: {
  lessons: Lesson[];
  completedLessonIds: Set<string>;
  courseId: string;
  currentLessonId: string;
}) {
  const list = (
    <ul className="flex flex-col gap-1">
      {lessons.map((lesson, index) => {
        const isCompleted = completedLessonIds.has(lesson.id);
        const isCurrent = lesson.id === currentLessonId;
        const icon = isCompleted ? '✓' : isCurrent ? '▶' : '○';

        return (
          <li key={lesson.id}>
            <Link
              href={`/learn/${courseId}/${lesson.id}`}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-[13px] ${
                isCurrent ? 'bg-indigo/10 font-semibold text-indigo' : 'text-n-7'
              }`}
            >
              <span className="w-4 text-center text-[12px]">{icon}</span>
              <span className="flex-1">
                {index + 1}강. {lesson.title}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex w-full flex-col gap-4 border-n-3 md:w-[240px] md:shrink-0 md:border-r md:pr-4">
      <details className="md:hidden" open>
        <summary className="cursor-pointer text-[13px] font-semibold text-n-9">커리큘럼</summary>
        <div className="mt-2">{list}</div>
      </details>
      <div className="hidden md:block">
        <h2 className="mb-2 text-[13px] font-semibold text-n-9">커리큘럼</h2>
        {list}
      </div>
      <ProgressBar completed={completedLessonIds.size} total={lessons.length} />
    </div>
  );
}
