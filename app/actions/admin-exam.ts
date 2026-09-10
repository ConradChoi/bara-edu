'use server';

import { redirect } from 'next/navigation';
import { requireAdminClient } from '@/lib/supabase/require-admin';

// 자격시험 문항 저작 (F-ADMC-8). admin-quiz.ts를 거의 그대로 복제하되 테이블명
// (course_exam_questions/course_exam_options)과 course_id 기준, 리다이렉트 경로만
// 다르다. 강의 퀴즈와 완전히 분리된 테이블이라 별도 파일로 둔다(product-manager 확정 —
// "무제한 재응시" 퀴즈 로직과 "횟수 제한·수료 게이팅" 시험 로직을 한 곳에 섞지 않는다).
// 문항 삭제 시 course_exam_options는 FK(on delete cascade)로 함께 지워진다.

function examPath(courseId: string) {
  return `/admin/courses/${courseId}/exam`;
}

export async function addExamQuestion(courseId: string, formData: FormData) {
  const question = (formData.get('question') as string | null)?.trim();
  if (!question) redirect(`${examPath(courseId)}?error=validation`);

  const supabase = await requireAdminClient();
  const { count } = await supabase
    .from('course_exam_questions')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', courseId);

  const { error } = await supabase.from('course_exam_questions').insert({ course_id: courseId, question, order: (count ?? 0) + 1 });
  if (error) redirect(`${examPath(courseId)}?error=failed`);
  redirect(`${examPath(courseId)}?success=questionAdded`);
}

export async function updateExamQuestion(questionId: string, courseId: string, formData: FormData) {
  const question = (formData.get('question') as string | null)?.trim();
  if (!question) redirect(`${examPath(courseId)}?error=validation`);

  const supabase = await requireAdminClient();
  const { error } = await supabase.from('course_exam_questions').update({ question }).eq('id', questionId);
  if (error) redirect(`${examPath(courseId)}?error=failed`);
  redirect(`${examPath(courseId)}?success=questionUpdated`);
}

export async function deleteExamQuestion(questionId: string, courseId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.from('course_exam_questions').delete().eq('id', questionId);
  if (error) redirect(`${examPath(courseId)}?error=failed`);
  redirect(`${examPath(courseId)}?success=questionDeleted`);
}

// 퀴즈 저작 화면에는 없는 순서변경 — F-ADMC-8이 명시적으로 요구한다.
// admin-categories.ts의 swapOrder()와 동일한 패턴(정렬된 형제 목록에서 인접 항목과 order를 맞바꿈).
async function swapExamQuestionOrder(questionId: string, courseId: string, direction: 'up' | 'down') {
  const supabase = await requireAdminClient();
  const { data: siblings, error } = await supabase
    .from('course_exam_questions')
    .select('id, order')
    .eq('course_id', courseId)
    .order('order', { ascending: true });
  if (error || !siblings) redirect(`${examPath(courseId)}?error=failed`);

  const idx = siblings!.findIndex((q) => q.id === questionId);
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= siblings!.length) redirect(examPath(courseId));

  const current = siblings![idx];
  const target = siblings![targetIdx];
  await supabase.from('course_exam_questions').update({ order: target.order }).eq('id', questionId);
  await supabase.from('course_exam_questions').update({ order: current.order }).eq('id', target.id);
  redirect(`${examPath(courseId)}?success=questionReordered`);
}

export async function moveExamQuestionUp(questionId: string, courseId: string) {
  await swapExamQuestionOrder(questionId, courseId, 'up');
}

export async function moveExamQuestionDown(questionId: string, courseId: string) {
  await swapExamQuestionOrder(questionId, courseId, 'down');
}

export async function addExamOption(questionId: string, courseId: string, formData: FormData) {
  const label = (formData.get('label') as string | null)?.trim();
  if (!label) redirect(`${examPath(courseId)}?error=validation`);

  const supabase = await requireAdminClient();
  const { count } = await supabase.from('course_exam_options').select('id', { count: 'exact', head: true }).eq('question_id', questionId);

  const { error } = await supabase.from('course_exam_options').insert({ question_id: questionId, label, order: (count ?? 0) + 1 });
  if (error) redirect(`${examPath(courseId)}?error=failed`);
  redirect(`${examPath(courseId)}?success=optionAdded`);
}

export async function updateExamOption(optionId: string, questionId: string, courseId: string, formData: FormData) {
  const label = (formData.get('label') as string | null)?.trim();
  if (!label) redirect(`${examPath(courseId)}?error=validation`);

  const supabase = await requireAdminClient();
  const { error } = await supabase.from('course_exam_options').update({ label }).eq('id', optionId);
  if (error) redirect(`${examPath(courseId)}?error=failed`);
  redirect(`${examPath(courseId)}?success=optionUpdated`);
}

export async function deleteExamOption(optionId: string, questionId: string, courseId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.from('course_exam_options').delete().eq('id', optionId);
  if (error) redirect(`${examPath(courseId)}?error=failed`);
  redirect(`${examPath(courseId)}?success=optionDeleted`);
}

// set_course_exam_correct_option() RPC로 원자적으로 처리한다(set_quiz_correct_option과 동일 이유).
export async function setExamCorrectOption(optionId: string, questionId: string, courseId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc('set_course_exam_correct_option', { p_question_id: questionId, p_option_id: optionId });
  if (error) redirect(`${examPath(courseId)}?error=failed`);
  redirect(`${examPath(courseId)}?success=correctSet`);
}
