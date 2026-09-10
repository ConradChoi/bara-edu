'use server';

import { redirect } from 'next/navigation';
import { requireAdminClient } from '@/lib/supabase/require-admin';

// 자격증 문제은행 저작 (2026-09-10 신규 — 강좌마다 문항을 새로 만들어야 했던 걸, 같은
// 자격증 안에서는 여러 강좌가 문항을 공유해 쓸 수 있도록 분리했다). 스코프는 처음엔
// 1Depth(자격증) 전체였다가, "전체 공용은 너무 넓어 문항 찾기가 어렵다"는 관리자 피드백으로
// 같은 날 2Depth(세부과정, 예: "2급"/"1급") 단위로 좁혔다 — 세부과정이 없는 자격증은
// 1Depth 루트 자체가 스코프가 된다(admin-queries.ts의 getExamBankCategories() 참고).
// admin-exam.ts(강좌↔문항 "연결" 관리)와 역할이 분리되어 있다 — 이 파일은 문항 내용
// (질문/보기/정답) 자체만 다룬다. admin-quiz.ts를 거의 그대로 복제하되 테이블명
// (exam_question_bank/exam_bank_options)과 categoryId 기준, 리다이렉트 경로만 다르다.

function bankPath(categoryId: string) {
  return `/admin/exam-bank?categoryId=${categoryId}`;
}

// categoryId가 실제로 문제은행 스코프로 유효한 카테고리인지 서버에서 재검증한다 —
// 1Depth라면 그 자체가 자격증으로 지정돼 있어야 하고, 2Depth라면 부모(1Depth)가
// 자격증으로 지정돼 있어야 한다(3Depth는 애초에 스코프가 될 수 없음). 클라이언트가
// 임의의 categoryId(예: 자격증 아닌 카테고리)를 보내면 문제은행이 엉뚱한 카테고리에
// 만들어질 수 있다(폼 hidden 값을 신뢰하지 않는다는 기존 원칙과 동일).
async function assertCertificationCategory(
  supabase: Awaited<ReturnType<typeof requireAdminClient>>,
  categoryId: string
) {
  const { data: category } = await supabase
    .from('categories')
    .select('depth, parent_id, is_certification')
    .eq('id', categoryId)
    .maybeSingle();
  if (!category) redirect('/admin/exam-bank?error=invalid-category');

  if (category.depth === 1) {
    if (!category.is_certification) redirect('/admin/exam-bank?error=invalid-category');
    return;
  }
  if (category.depth === 2 && category.parent_id) {
    const { data: parent } = await supabase.from('categories').select('is_certification').eq('id', category.parent_id).maybeSingle();
    if (parent?.is_certification) return;
  }
  redirect('/admin/exam-bank?error=invalid-category');
}

export async function addBankQuestion(categoryId: string, formData: FormData) {
  const question = (formData.get('question') as string | null)?.trim();
  if (!question) redirect(`${bankPath(categoryId)}&error=validation`);

  const supabase = await requireAdminClient();
  await assertCertificationCategory(supabase, categoryId);

  const { count } = await supabase
    .from('exam_question_bank')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId);

  const { error } = await supabase.from('exam_question_bank').insert({ category_id: categoryId, question, order: (count ?? 0) + 1 });
  if (error) redirect(`${bankPath(categoryId)}&error=failed`);
  redirect(`${bankPath(categoryId)}&success=questionAdded`);
}

export async function updateBankQuestion(questionId: string, categoryId: string, formData: FormData) {
  const question = (formData.get('question') as string | null)?.trim();
  if (!question) redirect(`${bankPath(categoryId)}&error=validation`);

  const supabase = await requireAdminClient();
  const { error } = await supabase.from('exam_question_bank').update({ question }).eq('id', questionId);
  if (error) redirect(`${bankPath(categoryId)}&error=failed`);
  redirect(`${bankPath(categoryId)}&success=questionUpdated`);
}

// 문항을 지우면 그 문항을 쓰던 모든 강좌의 시험에서도 사라진다(course_exam_question_links의
// on delete cascade) — 여러 강좌가 공유하는 구조이므로 삭제 확인 문구에서 이 점을 안내한다.
export async function deleteBankQuestion(questionId: string, categoryId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.from('exam_question_bank').delete().eq('id', questionId);
  if (error) redirect(`${bankPath(categoryId)}&error=failed`);
  redirect(`${bankPath(categoryId)}&success=questionDeleted`);
}

async function swapBankQuestionOrder(questionId: string, categoryId: string, direction: 'up' | 'down') {
  const supabase = await requireAdminClient();
  const { data: siblings, error } = await supabase
    .from('exam_question_bank')
    .select('id, order')
    .eq('category_id', categoryId)
    .order('order', { ascending: true });
  if (error || !siblings) redirect(`${bankPath(categoryId)}&error=failed`);

  const idx = siblings!.findIndex((q) => q.id === questionId);
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= siblings!.length) redirect(bankPath(categoryId));

  const current = siblings![idx];
  const target = siblings![targetIdx];
  await supabase.from('exam_question_bank').update({ order: target.order }).eq('id', questionId);
  await supabase.from('exam_question_bank').update({ order: current.order }).eq('id', target.id);
  redirect(`${bankPath(categoryId)}&success=questionReordered`);
}

export async function moveBankQuestionUp(questionId: string, categoryId: string) {
  await swapBankQuestionOrder(questionId, categoryId, 'up');
}

export async function moveBankQuestionDown(questionId: string, categoryId: string) {
  await swapBankQuestionOrder(questionId, categoryId, 'down');
}

export async function addBankOption(questionId: string, categoryId: string, formData: FormData) {
  const label = (formData.get('label') as string | null)?.trim();
  if (!label) redirect(`${bankPath(categoryId)}&error=validation`);

  const supabase = await requireAdminClient();
  const { count } = await supabase.from('exam_bank_options').select('id', { count: 'exact', head: true }).eq('bank_question_id', questionId);

  const { error } = await supabase.from('exam_bank_options').insert({ bank_question_id: questionId, label, order: (count ?? 0) + 1 });
  if (error) redirect(`${bankPath(categoryId)}&error=failed`);
  redirect(`${bankPath(categoryId)}&success=optionAdded`);
}

export async function updateBankOption(optionId: string, questionId: string, categoryId: string, formData: FormData) {
  const label = (formData.get('label') as string | null)?.trim();
  if (!label) redirect(`${bankPath(categoryId)}&error=validation`);

  const supabase = await requireAdminClient();
  const { error } = await supabase.from('exam_bank_options').update({ label }).eq('id', optionId);
  if (error) redirect(`${bankPath(categoryId)}&error=failed`);
  redirect(`${bankPath(categoryId)}&success=optionUpdated`);
}

export async function deleteBankOption(optionId: string, questionId: string, categoryId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.from('exam_bank_options').delete().eq('id', optionId);
  if (error) redirect(`${bankPath(categoryId)}&error=failed`);
  redirect(`${bankPath(categoryId)}&success=optionDeleted`);
}

// set_course_exam_correct_option() RPC로 원자적으로 처리한다(set_quiz_correct_option과 동일 이유).
export async function setBankCorrectOption(optionId: string, questionId: string, categoryId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc('set_course_exam_correct_option', { p_question_id: questionId, p_option_id: optionId });
  if (error) redirect(`${bankPath(categoryId)}&error=failed`);
  redirect(`${bankPath(categoryId)}&success=correctSet`);
}
