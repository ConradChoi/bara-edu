import { submitCourseExam } from '@/app/actions/classroom-exam';
import type { CourseExamQuestionWithOptions } from '@/lib/types';

// F-LRN-7b: 객관식(단일 정답) 응시. QuizForm과 동일한 라디오+순수 form 구조를 재사용하되,
// 강좌 단위 제출(submitCourseExam)로 연결한다. 재응시 횟수 제한은 RPC가 서버에서 강제한다.
export default function ExamForm({ courseId, questions }: { courseId: string; questions: CourseExamQuestionWithOptions[] }) {
  return (
    <form action={submitCourseExam.bind(null, courseId)} className="flex flex-col gap-5">
      {questions.map((q, index) => (
        <fieldset key={q.id} className="flex flex-col gap-2">
          <legend className="text-[13.5px] font-medium text-n-9">
            {index + 1}. {q.question}
          </legend>
          {q.options.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-[13px] text-n-7">
              <input type="radio" name={`answer_${q.id}`} value={option.id} required className="h-4 w-4" />
              {option.label}
            </label>
          ))}
        </fieldset>
      ))}
      <button type="submit" className="h-11 self-start rounded-pill bg-pink px-5 text-[13px] font-semibold text-white">
        제출하고 결과 보기
      </button>
    </form>
  );
}
