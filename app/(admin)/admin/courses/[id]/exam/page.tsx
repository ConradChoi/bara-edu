import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  addExamOption,
  addExamQuestion,
  deleteExamOption,
  deleteExamQuestion,
  moveExamQuestionDown,
  moveExamQuestionUp,
  setExamCorrectOption,
  updateExamOption,
  updateExamQuestion,
} from '@/app/actions/admin-exam';
import StatusBadge from '@/components/admin/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { getAdminCourseById, getCourseExamQuestionsForCourse } from '@/lib/supabase/admin-queries';

export const metadata: Metadata = { title: '자격시험 관리 | 관리자' };

const SUCCESS_MESSAGE: Record<string, string> = {
  questionAdded: '문항을 추가했어요.',
  questionUpdated: '문항을 수정했어요.',
  questionDeleted: '문항을 삭제했어요.',
  questionReordered: '순서를 변경했어요.',
  optionAdded: '보기를 추가했어요.',
  optionUpdated: '보기를 수정했어요.',
  optionDeleted: '보기를 삭제했어요.',
  correctSet: '정답을 설정했어요.',
};

const ERROR_MESSAGE: Record<string, string> = {
  validation: '내용을 입력해주세요.',
  failed: '처리 중 문제가 발생했어요.',
};

export default async function AdminCourseExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id: courseId } = await params;
  const { success, error } = await searchParams;

  const course = await getAdminCourseById(courseId);
  if (!course) notFound();

  const questions = await getCourseExamQuestionsForCourse(courseId);
  const unresolvedCount = questions.filter((q) => !q.options.some((o) => o.isCorrect)).length;

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/admin/courses/${courseId}`} className="text-[12px] text-n-6">
          ← 강좌 수정으로 돌아가기
        </Link>
        <h1 className="text-[20px] font-semibold text-n-9">자격시험 관리 — {course.title}</h1>
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

      {course.requiresExam ? (
        <p className="text-[12.5px] text-n-6">
          합격 기준 {course.examPassScore}% · 최대 응시 {course.examMaxAttempts}회 ·{' '}
          <Link href={`/admin/courses/${courseId}`} className="underline">
            강좌 수정에서 변경
          </Link>
        </p>
      ) : (
        <div className="rounded-md border border-warning bg-warning/10 px-3.5 py-3 text-[13px] font-medium text-warning">
          이 강좌는 자격시험이 설정되어 있지 않아요. 강좌 수정 화면에서 먼저 켜주세요.{' '}
          <Link href={`/admin/courses/${courseId}`} className="underline">
            강좌 수정으로 이동
          </Link>
        </div>
      )}

      {unresolvedCount > 0 && (
        <div className="rounded-md border border-warning bg-warning/10 px-3.5 py-3 text-[13px] font-medium text-warning">
          정답이 설정되지 않은 문항이 {unresolvedCount}개 있어요. 학습자 제출 시 해당 문항은 항상 오답으로 채점돼요.
        </div>
      )}

      {questions.length === 0 ? (
        <p className="text-[13px] text-n-6">
          등록된 문항이 없어요. 문항이 0개인 동안 학습자에게는 &quot;시험 준비 중&quot; 안내만 보여요.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {questions.map((q, index) => (
            <li key={q.id} className="rounded-lg border border-n-3 p-4">
              <div className="flex items-start gap-2">
                <span className="mt-2 text-[12px] text-n-5">{index + 1}.</span>
                <form action={updateExamQuestion.bind(null, q.id, courseId)} className="flex flex-1 items-center gap-2">
                  <input
                    name="question"
                    defaultValue={q.question}
                    className="h-9 flex-1 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
                  />
                  <button type="submit" className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7">
                    저장
                  </button>
                </form>
                <form action={moveExamQuestionUp.bind(null, q.id, courseId)}>
                  <button type="submit" className="rounded-pill border border-n-3 px-2 py-1 text-[11px] text-n-7">
                    ▲
                  </button>
                </form>
                <form action={moveExamQuestionDown.bind(null, q.id, courseId)}>
                  <button type="submit" className="rounded-pill border border-n-3 px-2 py-1 text-[11px] text-n-7">
                    ▼
                  </button>
                </form>
                <ConfirmDialog
                  triggerLabel="문항 삭제"
                  triggerClassName="rounded-pill border border-danger px-2.5 py-1 text-[11.5px] text-danger"
                  title="문항을 삭제할까요?"
                  description="보기도 함께 삭제돼요."
                  confirmLabel="삭제"
                  tone="danger"
                  action={deleteExamQuestion.bind(null, q.id, courseId)}
                />
              </div>

              <ul className="mt-3 flex flex-col gap-1.5 pl-6">
                {q.options.map((option) => (
                  <li key={option.id} className="flex items-center gap-2">
                    <form
                      action={updateExamOption.bind(null, option.id, q.id, courseId)}
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
                      <form action={setExamCorrectOption.bind(null, option.id, q.id, courseId)}>
                        <button type="submit" className="rounded-pill border border-n-3 px-2 py-1 text-[11px] text-n-7">
                          정답으로 설정
                        </button>
                      </form>
                    )}
                    <form action={deleteExamOption.bind(null, option.id, q.id, courseId)}>
                      <button type="submit" className="rounded-pill border border-danger px-2 py-1 text-[11px] text-danger">
                        삭제
                      </button>
                    </form>
                  </li>
                ))}
              </ul>

              <form action={addExamOption.bind(null, q.id, courseId)} className="mt-2 flex items-center gap-2 pl-6">
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

      <form action={addExamQuestion.bind(null, courseId)} className="flex items-center gap-2 rounded-lg border border-n-3 bg-n-1 p-3">
        <input name="question" placeholder="새 문항" className="h-9 flex-1 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]" />
        <button type="submit" className="rounded-pill bg-pink px-4 py-1.5 text-[12.5px] font-semibold text-white">
          문항 추가
        </button>
      </form>
    </div>
  );
}
