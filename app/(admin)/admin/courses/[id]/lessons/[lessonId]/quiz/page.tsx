import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  addOption,
  addQuestion,
  deleteOption,
  deleteQuestion,
  setCorrectOption,
  updateOption,
  updateQuestion,
} from '@/app/actions/admin-quiz';
import StatusBadge from '@/components/admin/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { getQuizQuestionsForLesson } from '@/lib/supabase/admin-queries';
import { getLessonById } from '@/lib/supabase/classroom-queries';

export const metadata: Metadata = { title: '퀴즈 관리 | 관리자' };

const SUCCESS_MESSAGE: Record<string, string> = {
  questionAdded: '문항을 추가했어요.',
  questionUpdated: '문항을 수정했어요.',
  questionDeleted: '문항을 삭제했어요.',
  optionAdded: '보기를 추가했어요.',
  optionUpdated: '보기를 수정했어요.',
  optionDeleted: '보기를 삭제했어요.',
  correctSet: '정답을 설정했어요.',
};

const ERROR_MESSAGE: Record<string, string> = {
  validation: '내용을 입력해주세요.',
  failed: '처리 중 문제가 발생했어요.',
};

export default async function AdminLessonQuizPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; lessonId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id: courseId, lessonId } = await params;
  const { success, error } = await searchParams;

  const lesson = await getLessonById(lessonId);
  if (!lesson || lesson.courseId !== courseId) notFound();

  const questions = await getQuizQuestionsForLesson(lessonId);

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/admin/courses/${courseId}`} className="text-[12px] text-n-6">
          ← 강좌 수정으로 돌아가기
        </Link>
        <h1 className="text-[20px] font-semibold text-n-9">퀴즈 관리 — {lesson.title}</h1>
      </div>

      {success && SUCCESS_MESSAGE[success] && (
        <div className="rounded-md border border-success bg-success/10 px-3.5 py-3 text-[13px] font-medium text-success">
          {SUCCESS_MESSAGE[success]}
        </div>
      )}
      {error && ERROR_MESSAGE[error] && (
        <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          {ERROR_MESSAGE[error]}
        </div>
      )}

      {questions.length === 0 ? (
        <p className="text-[13px] text-n-6">등록된 문항이 없어요.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {questions.map((q, index) => (
            <li key={q.id} className="rounded-lg border border-n-3 p-4">
              <div className="flex items-start gap-2">
                <span className="mt-2 text-[12px] text-n-5">{index + 1}.</span>
                <form action={updateQuestion.bind(null, q.id, lessonId, courseId)} className="flex flex-1 items-center gap-2">
                  <input
                    name="question"
                    defaultValue={q.question}
                    className="h-9 flex-1 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
                  />
                  <button type="submit" className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7">
                    저장
                  </button>
                </form>
                <ConfirmDialog
                  triggerLabel="문항 삭제"
                  triggerClassName="rounded-pill border border-danger px-2.5 py-1 text-[11.5px] text-danger"
                  title="문항을 삭제할까요?"
                  description="보기도 함께 삭제돼요."
                  confirmLabel="삭제"
                  tone="danger"
                  action={deleteQuestion.bind(null, q.id, lessonId, courseId)}
                />
              </div>

              <ul className="mt-3 flex flex-col gap-1.5 pl-6">
                {q.options.map((option) => (
                  <li key={option.id} className="flex items-center gap-2">
                    <form
                      action={updateOption.bind(null, option.id, q.id, lessonId, courseId)}
                      className="flex flex-1 items-center gap-2"
                    >
                      <input
                        name="label"
                        defaultValue={option.label}
                        className="h-8 flex-1 rounded-md border border-n-3 bg-n-0 px-2 text-[12.5px]"
                      />
                      <button type="submit" className="rounded-pill border border-n-3 px-2 py-1 text-[11px] text-n-7">
                        저장
                      </button>
                    </form>
                    {option.isCorrect ? (
                      <StatusBadge tone="success">정답</StatusBadge>
                    ) : (
                      <form action={setCorrectOption.bind(null, option.id, q.id, lessonId, courseId)}>
                        <button type="submit" className="rounded-pill border border-n-3 px-2 py-1 text-[11px] text-n-7">
                          정답으로 설정
                        </button>
                      </form>
                    )}
                    <form action={deleteOption.bind(null, option.id, q.id, lessonId, courseId)}>
                      <button type="submit" className="rounded-pill border border-danger px-2 py-1 text-[11px] text-danger">
                        삭제
                      </button>
                    </form>
                  </li>
                ))}
              </ul>

              <form action={addOption.bind(null, q.id, lessonId, courseId)} className="mt-2 flex items-center gap-2 pl-6">
                <input
                  name="label"
                  placeholder="보기 추가"
                  className="h-8 flex-1 rounded-md border border-n-3 bg-n-0 px-2 text-[12.5px]"
                />
                <button type="submit" className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7">
                  추가
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={addQuestion.bind(null, lessonId, courseId)} className="flex items-center gap-2 rounded-lg border border-n-3 bg-n-1 p-3">
        <input name="question" placeholder="새 문항" className="h-9 flex-1 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]" />
        <button type="submit" className="rounded-pill bg-pink px-4 py-1.5 text-[12.5px] font-semibold text-white">
          문항 추가
        </button>
      </form>
    </div>
  );
}
