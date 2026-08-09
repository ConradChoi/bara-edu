'use server';

import { redirect } from 'next/navigation';
import { requireAdminClient } from '@/lib/supabase/require-admin';

// 퀴즈 저작 (F-LRN-4의 선행 조건). 문항 삭제 시 quiz_options는 FK(on delete cascade)로 함께 지워진다.

function quizPath(courseId: string, lessonId: string) {
  return `/admin/courses/${courseId}/lessons/${lessonId}/quiz`;
}

export async function addQuestion(lessonId: string, courseId: string, formData: FormData) {
  const question = (formData.get('question') as string | null)?.trim();
  if (!question) redirect(`${quizPath(courseId, lessonId)}?error=validation`);

  const supabase = await requireAdminClient();
  const { count } = await supabase.from('quiz_questions').select('id', { count: 'exact', head: true }).eq('lesson_id', lessonId);

  const { error } = await supabase.from('quiz_questions').insert({ lesson_id: lessonId, question, order: (count ?? 0) + 1 });
  if (error) redirect(`${quizPath(courseId, lessonId)}?error=failed`);
  redirect(`${quizPath(courseId, lessonId)}?success=questionAdded`);
}

export async function updateQuestion(questionId: string, lessonId: string, courseId: string, formData: FormData) {
  const question = (formData.get('question') as string | null)?.trim();
  if (!question) redirect(`${quizPath(courseId, lessonId)}?error=validation`);

  const supabase = await requireAdminClient();
  const { error } = await supabase.from('quiz_questions').update({ question }).eq('id', questionId);
  if (error) redirect(`${quizPath(courseId, lessonId)}?error=failed`);
  redirect(`${quizPath(courseId, lessonId)}?success=questionUpdated`);
}

export async function deleteQuestion(questionId: string, lessonId: string, courseId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.from('quiz_questions').delete().eq('id', questionId);
  if (error) redirect(`${quizPath(courseId, lessonId)}?error=failed`);
  redirect(`${quizPath(courseId, lessonId)}?success=questionDeleted`);
}

export async function addOption(questionId: string, lessonId: string, courseId: string, formData: FormData) {
  const label = (formData.get('label') as string | null)?.trim();
  if (!label) redirect(`${quizPath(courseId, lessonId)}?error=validation`);

  const supabase = await requireAdminClient();
  const { count } = await supabase.from('quiz_options').select('id', { count: 'exact', head: true }).eq('question_id', questionId);

  const { error } = await supabase.from('quiz_options').insert({ question_id: questionId, label, order: (count ?? 0) + 1 });
  if (error) redirect(`${quizPath(courseId, lessonId)}?error=failed`);
  redirect(`${quizPath(courseId, lessonId)}?success=optionAdded`);
}

export async function updateOption(optionId: string, questionId: string, lessonId: string, courseId: string, formData: FormData) {
  const label = (formData.get('label') as string | null)?.trim();
  if (!label) redirect(`${quizPath(courseId, lessonId)}?error=validation`);

  const supabase = await requireAdminClient();
  const { error } = await supabase.from('quiz_options').update({ label }).eq('id', optionId);
  if (error) redirect(`${quizPath(courseId, lessonId)}?error=failed`);
  redirect(`${quizPath(courseId, lessonId)}?success=optionUpdated`);
}

export async function deleteOption(optionId: string, questionId: string, lessonId: string, courseId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.from('quiz_options').delete().eq('id', optionId);
  if (error) redirect(`${quizPath(courseId, lessonId)}?error=failed`);
  redirect(`${quizPath(courseId, lessonId)}?success=optionDeleted`);
}

// set_quiz_correct_option() RPC로 원자적으로 처리한다 — 애초에 두 번의 순차 update로
// 구현했었으나, 두 번째가 실패하면 그 문항에 정답이 0개로 남아 채점이 조용히 틀어지는
// 문제가 있어 하나의 함수(트랜잭션)로 바꿨다(qa-reviewer 점검, 2026-08-09).
export async function setCorrectOption(optionId: string, questionId: string, lessonId: string, courseId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc('set_quiz_correct_option', { p_question_id: questionId, p_option_id: optionId });
  if (error) redirect(`${quizPath(courseId, lessonId)}?error=failed`);
  redirect(`${quizPath(courseId, lessonId)}?success=correctSet`);
}
