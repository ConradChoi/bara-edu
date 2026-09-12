import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  addBankOption,
  addBankQuestion,
  deleteBankOption,
  deleteBankQuestion,
  moveBankQuestionDown,
  moveBankQuestionUp,
  setBankCorrectOption,
  updateBankOption,
  updateBankQuestion,
} from '@/app/actions/admin-exam-bank';
import StatusBadge from '@/components/admin/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { getExamBankCategories, getExamBankQuestionsForCategory } from '@/lib/supabase/admin-queries';

export const metadata: Metadata = { title: '문제은행 관리 | 관리자' };

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
  'invalid-category': '유효하지 않은 카테고리예요.',
};

export default async function AdminExamBankPage({
  searchParams,
}: {
  searchParams: Promise<{ categoryId?: string; success?: string; error?: string }>;
}) {
  const { categoryId, success, error } = await searchParams;

  const categories = await getExamBankCategories();
  if (!categoryId && categories.length > 0) {
    redirect(`/admin/exam-bank?categoryId=${categories[0].id}`);
  }

  const questions = categoryId ? await getExamBankQuestionsForCategory(categoryId) : [];
  const unresolvedCount = questions.filter((q) =>
    q.questionType === 'short_answer' ? !q.answerText?.trim() : !q.options.some((o) => o.isCorrect)
  ).length;

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[20px] font-semibold text-n-9">문제은행 관리</h1>
        <p className="text-[12.5px] text-n-6">같은 세부과정(예: &quot;2급&quot;)에 속한 강좌들은 여기서 만든 문항을 공유해서 시험에 쓸 수 있어요.</p>
      </div>

      {categories.length === 0 ? (
        <p className="text-[13px] text-n-6">
          자격증으로 지정된 카테고리가 없어요.{' '}
          <Link href="/admin/categories" className="underline">
            카테고리 관리
          </Link>
          에서 먼저 지정해주세요.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/admin/exam-bank?categoryId=${category.id}`}
              className={`rounded-pill border px-3.5 py-1.5 text-[12.5px] font-medium ${
                category.id === categoryId ? 'border-pink bg-pink/10 text-pink' : 'border-n-3 text-n-7'
              }`}
            >
              {category.label}
            </Link>
          ))}
        </div>
      )}

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

      {categoryId && (
        <>
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="flex flex-1 flex-col gap-2 rounded-lg border border-n-3 bg-n-1 p-3">
              <p className="text-[13px] font-semibold text-n-9">객관식 문항 추가</p>
              <form action={addBankQuestion.bind(null, categoryId)} className="flex items-center gap-2">
                <input type="hidden" name="questionType" value="multiple_choice" />
                <input name="question" placeholder="새 객관식 문항" className="h-9 flex-1 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]" />
                <button
                  type="submit"
                  className="shrink-0 whitespace-nowrap rounded-pill bg-pink px-4 py-1.5 text-[12.5px] font-semibold text-white"
                >
                  추가
                </button>
              </form>
            </div>
            <div className="flex flex-1 flex-col gap-2 rounded-lg border border-n-3 bg-n-1 p-3">
              <p className="text-[13px] font-semibold text-n-9">주관식 문항 추가</p>
              <form action={addBankQuestion.bind(null, categoryId)} className="flex items-center gap-2">
                <input type="hidden" name="questionType" value="short_answer" />
                <input name="question" placeholder="새 주관식 문항" className="h-9 flex-1 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]" />
                <input name="answerText" placeholder="정답" className="h-9 w-[110px] rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]" />
                <button
                  type="submit"
                  className="shrink-0 whitespace-nowrap rounded-pill bg-pink px-4 py-1.5 text-[12.5px] font-semibold text-white"
                >
                  추가
                </button>
              </form>
            </div>
          </div>

          {unresolvedCount > 0 && (
            <div className="rounded-md border border-warning bg-warning/10 px-3.5 py-3 text-[13px] font-medium text-warning">
              정답이 설정되지 않은 문항이 {unresolvedCount}개 있어요. 학습자 제출 시 해당 문항은 항상 오답으로 채점돼요.
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
                    <form action={updateBankQuestion.bind(null, q.id, categoryId)} className="flex flex-1 items-center gap-2">
                      <input
                        name="question"
                        defaultValue={q.question}
                        className="h-9 flex-1 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
                      />
                      {q.questionType === 'short_answer' && (
                        <input
                          name="answerText"
                          defaultValue={q.answerText ?? ''}
                          placeholder="정답"
                          className="h-9 w-[160px] rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
                        />
                      )}
                      <button type="submit" className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7">
                        저장
                      </button>
                    </form>
                    <StatusBadge tone="neutral">{q.questionType === 'short_answer' ? '주관식' : '객관식'}</StatusBadge>
                    <form action={moveBankQuestionUp.bind(null, q.id, categoryId)}>
                      <button type="submit" className="rounded-pill border border-n-3 px-2 py-1 text-[11px] text-n-7">
                        ▲
                      </button>
                    </form>
                    <form action={moveBankQuestionDown.bind(null, q.id, categoryId)}>
                      <button type="submit" className="rounded-pill border border-n-3 px-2 py-1 text-[11px] text-n-7">
                        ▼
                      </button>
                    </form>
                    <ConfirmDialog
                      triggerLabel="문항 삭제"
                      triggerClassName="rounded-pill border border-danger px-2.5 py-1 text-[11.5px] text-danger"
                      title="문항을 삭제할까요?"
                      description="이 문항을 쓰던 모든 강좌의 시험에서도 함께 사라져요."
                      confirmLabel="삭제"
                      tone="danger"
                      action={deleteBankQuestion.bind(null, q.id, categoryId)}
                    />
                  </div>

                  {q.questionType === 'multiple_choice' && (
                    <>
                      <ul className="mt-3 flex flex-col gap-1.5 pl-6">
                        {q.options.map((option) => (
                          <li key={option.id} className="flex items-center gap-2">
                            <form
                              action={updateBankOption.bind(null, option.id, q.id, categoryId)}
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
                              <form action={setBankCorrectOption.bind(null, option.id, q.id, categoryId)}>
                                <button type="submit" className="rounded-pill border border-n-3 px-2 py-1 text-[11px] text-n-7">
                                  정답으로 설정
                                </button>
                              </form>
                            )}
                            <form action={deleteBankOption.bind(null, option.id, q.id, categoryId)}>
                              <button type="submit" className="rounded-pill border border-danger px-2 py-1 text-[11px] text-danger">
                                삭제
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>

                      <form action={addBankOption.bind(null, q.id, categoryId)} className="mt-2 flex items-center gap-2 pl-6">
                        <input
                          name="label"
                          placeholder="보기 추가"
                          className="h-8 flex-1 rounded-md border border-n-3 bg-n-0 px-2 text-[12.5px]"
                        />
                        <button type="submit" className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7">
                          추가
                        </button>
                      </form>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
