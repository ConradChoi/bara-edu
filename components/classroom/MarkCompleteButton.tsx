import { markLessonComplete } from '@/app/actions/classroom';

// F-LRN-3: 자동 완료 아님 — 사용자가 직접 눌러야 기록된다. 반복 가능한 일상 동작이라
// ConfirmDialog 없이 바로 제출한다(module-lms-6의 "routine action = plain form" 관례).
export default function MarkCompleteButton({
  lessonId,
  courseId,
  alreadyCompleted,
}: {
  lessonId: string;
  courseId: string;
  alreadyCompleted: boolean;
}) {
  if (alreadyCompleted) {
    return <p className="text-[13px] font-medium text-success">완료됨 ✓</p>;
  }

  return (
    <form action={markLessonComplete.bind(null, lessonId, courseId)}>
      <button type="submit" className="rounded-pill bg-pink px-4 py-2 text-[13px] font-semibold text-white">
        학습 완료로 표시
      </button>
    </form>
  );
}
