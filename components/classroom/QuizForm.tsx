import { submitQuiz } from '@/app/actions/classroom';
import type { QuizQuestionWithOptions } from '@/lib/types';

// F-LRN-4: 객관식(단일 정답) 응시. 라디오 그룹 + 순수 form 제출 — client JS 불필요.
// 재응시 무제한(Q5)이라 별도 잠금 없이 항상 다시 응시할 수 있게 둔다.
export default function QuizForm({
  lessonId,
  courseId,
  questions,
}: {
  lessonId: string;
  courseId: string;
  questions: QuizQuestionWithOptions[];
}) {
  return (
    <form action={submitQuiz.bind(null, lessonId, courseId)} className="flex flex-col gap-5">
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
        제출하고 채점 결과 보기
      </button>
    </form>
  );
}
