import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { linkBankQuestionToCourse, moveCourseExamLinkDown, moveCourseExamLinkUp, unlinkBankQuestionFromCourse } from '@/app/actions/admin-exam';
import StatusBadge from '@/components/admin/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { getAdminCourseById, getAvailableBankQuestionsForCourse, getCourseCertificationCategoryId, getCourseExamQuestionsForCourse } from '@/lib/supabase/admin-queries';

export const metadata: Metadata = { title: '자격시험 관리 | 관리자' };

const SUCCESS_MESSAGE: Record<string, string> = {
  questionAdded: '문항을 연결했어요.',
  questionDeleted: '문항 연결을 해제했어요.',
  questionReordered: '순서를 변경했어요.',
};

const ERROR_MESSAGE: Record<string, string> = {
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

  const [links, availableQuestions, categoryId] = await Promise.all([
    getCourseExamQuestionsForCourse(courseId),
    getAvailableBankQuestionsForCourse(courseId),
    getCourseCertificationCategoryId(courseId),
  ]);
  const unresolvedCount = links.filter((l) =>
    l.questionType === 'short_answer' ? !l.answerText?.trim() : !l.options.some((o) => o.isCorrect)
  ).length;

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
          정답이 설정되지 않은 문항이 {unresolvedCount}개 있어요. 문제은행에서 정답을 먼저 설정해주세요.
        </div>
      )}

      <div className="flex items-center justify-between rounded-md border border-n-3 bg-n-1 px-3.5 py-3">
        <p className="text-[12.5px] text-n-6">문항의 내용(질문/보기/정답)은 이제 문제은행에서 관리해요. 이 화면에서는 문항 연결과 순서만 다뤄요.</p>
        {categoryId && (
          <Link href={`/admin/exam-bank?categoryId=${categoryId}`} className="shrink-0 rounded-pill border border-n-4 px-3 py-1.5 text-[12px] font-medium text-n-8">
            문제은행 관리로 이동
          </Link>
        )}
      </div>

      {links.length === 0 ? (
        <p className="text-[13px] text-n-6">
          연결된 문항이 없어요. 문항이 0개인 동안 학습자에게는 &quot;시험 준비 중&quot; 안내만 보여요.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {links.map((link, index) => (
            <li key={link.linkId} className="rounded-lg border border-n-3 p-4">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-[12px] text-n-5">{index + 1}.</span>
                <p className="flex-1 text-[13px] font-medium text-n-9">{link.question}</p>
                <StatusBadge tone="neutral">{link.questionType === 'short_answer' ? '주관식' : '객관식'}</StatusBadge>
                <form action={moveCourseExamLinkUp.bind(null, link.linkId, courseId)}>
                  <button type="submit" className="rounded-pill border border-n-3 px-2 py-1 text-[11px] text-n-7">
                    ▲
                  </button>
                </form>
                <form action={moveCourseExamLinkDown.bind(null, link.linkId, courseId)}>
                  <button type="submit" className="rounded-pill border border-n-3 px-2 py-1 text-[11px] text-n-7">
                    ▼
                  </button>
                </form>
                <ConfirmDialog
                  triggerLabel="연결 해제"
                  triggerClassName="rounded-pill border border-danger px-2.5 py-1 text-[11.5px] text-danger"
                  title="문항 연결을 해제할까요?"
                  description="문제은행의 문항 자체는 삭제되지 않아요. 이 강좌 시험에서만 빠져요."
                  confirmLabel="해제"
                  tone="danger"
                  action={unlinkBankQuestionFromCourse.bind(null, link.linkId, courseId)}
                />
              </div>

              {link.questionType === 'short_answer' ? (
                <p className="mt-3 pl-6 text-[12.5px] text-n-7">
                  정답: <span className="font-medium text-n-9">{link.answerText ?? '(미설정)'}</span>
                </p>
              ) : (
                <ul className="mt-3 flex flex-col gap-1 pl-6">
                  {link.options.map((option) => (
                    <li key={option.id} className="flex items-center gap-2 text-[12.5px] text-n-7">
                      <span>{option.label}</span>
                      {option.isCorrect && <StatusBadge tone="success">정답</StatusBadge>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-n-3 bg-n-1 p-4">
        <p className="mb-3 text-[13px] font-semibold text-n-9">문제은행에서 추가</p>
        {availableQuestions.length === 0 ? (
          <p className="text-[12.5px] text-n-6">
            추가할 수 있는 문항이 없어요.{' '}
            {categoryId && (
              <Link href={`/admin/exam-bank?categoryId=${categoryId}`} className="underline">
                문제은행에서 문항을 먼저 만들어주세요.
              </Link>
            )}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {availableQuestions.map((q) => (
              <li key={q.id} className="flex items-center gap-2">
                <span className="flex-1 text-[12.5px] text-n-8">{q.question}</span>
                <StatusBadge tone="neutral">{q.questionType === 'short_answer' ? '주관식' : '객관식'}</StatusBadge>
                <form action={linkBankQuestionToCourse.bind(null, courseId, q.id)}>
                  <button type="submit" className="rounded-pill bg-pink px-3 py-1 text-[11.5px] font-semibold text-white">
                    추가
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
