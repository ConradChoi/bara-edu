'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// 자격시험(module-lms-9, 2026-09-09) 학습자 액션. 채점/게이팅(진도·과제·잔여횟수·기합격
// 여부)은 전부 submit_course_exam() RPC가 서버에서 auth.uid() 기준으로 재검증한다
// (classroom.ts의 submitQuiz와 동일 원칙 — 타인 명의 제출 불가, 클라이언트 상태를 신뢰하지 않음).
export async function submitCourseExam(courseId: string, formData: FormData) {
  const supabase = await createClient();
  const selectedOptionIds = [...formData.entries()]
    .filter(([key]) => key.startsWith('answer_'))
    .map(([, value]) => value as string);

  const { error } = await supabase.rpc('submit_course_exam', {
    p_course_id: courseId,
    p_selected_option_ids: selectedOptionIds,
  });

  if (error) redirect(`/learn/${courseId}/exam?error=exam-failed`);
  redirect(`/learn/${courseId}/exam`);
}
