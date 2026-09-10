'use server';

import { redirect } from 'next/navigation';
import { requireAdminClient } from '@/lib/supabase/require-admin';

// 강좌 시험 문항 "연결" 관리 (F-ADMC-8). 문항 내용 자체(질문/보기/정답)는 이제 문제은행
// 소유라 여기서 다루지 않는다 — app/actions/admin-exam-bank.ts 참고. 이 파일은 "이 강좌의
// 시험이 문제은행의 어떤 문항을 어떤 순서로 쓰는지"(course_exam_question_links)만 다룬다.

function examPath(courseId: string) {
  return `/admin/courses/${courseId}/exam`;
}

export async function linkBankQuestionToCourse(courseId: string, bankQuestionId: string) {
  const supabase = await requireAdminClient();
  const { count } = await supabase
    .from('course_exam_question_links')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', courseId);

  const { error } = await supabase
    .from('course_exam_question_links')
    .insert({ course_id: courseId, bank_question_id: bankQuestionId, order: (count ?? 0) + 1 });
  if (error) redirect(`${examPath(courseId)}?error=failed`);
  redirect(`${examPath(courseId)}?success=questionAdded`);
}

export async function unlinkBankQuestionFromCourse(linkId: string, courseId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.from('course_exam_question_links').delete().eq('id', linkId);
  if (error) redirect(`${examPath(courseId)}?error=failed`);
  redirect(`${examPath(courseId)}?success=questionDeleted`);
}

// admin-categories.ts의 swapOrder()와 동일한 패턴(정렬된 형제 목록에서 인접 항목과 order를 맞바꿈).
async function swapCourseExamLinkOrder(linkId: string, courseId: string, direction: 'up' | 'down') {
  const supabase = await requireAdminClient();
  const { data: siblings, error } = await supabase
    .from('course_exam_question_links')
    .select('id, order')
    .eq('course_id', courseId)
    .order('order', { ascending: true });
  if (error || !siblings) redirect(`${examPath(courseId)}?error=failed`);

  const idx = siblings!.findIndex((l) => l.id === linkId);
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= siblings!.length) redirect(examPath(courseId));

  const current = siblings![idx];
  const target = siblings![targetIdx];
  await supabase.from('course_exam_question_links').update({ order: target.order }).eq('id', linkId);
  await supabase.from('course_exam_question_links').update({ order: current.order }).eq('id', target.id);
  redirect(`${examPath(courseId)}?success=questionReordered`);
}

export async function moveCourseExamLinkUp(linkId: string, courseId: string) {
  await swapCourseExamLinkOrder(linkId, courseId, 'up');
}

export async function moveCourseExamLinkDown(linkId: string, courseId: string) {
  await swapCourseExamLinkOrder(linkId, courseId, 'down');
}
