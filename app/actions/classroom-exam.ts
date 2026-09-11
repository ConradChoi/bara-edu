'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// 자격시험(module-lms-9, 2026-09-09; 2026-09-11 주관식 추가) 학습자 액션. 채점/게이팅
// (진도·과제·잔여횟수·기합격 여부)은 전부 submit_course_exam() RPC가 서버에서 auth.uid()
// 기준으로 재검증한다(classroom.ts의 submitQuiz와 동일 원칙 — 타인 명의 제출 불가,
// 클라이언트 상태를 신뢰하지 않음). ExamForm.tsx가 문항마다 `answer_${questionId}`(값)와
// `type_${questionId}`(objective/short_answer)를 함께 제출하므로, 여기서 문항 유형에 맞게
// option_id/answer_text로 나눠 jsonb 배열로 재구성한다.
export async function submitCourseExam(courseId: string, formData: FormData) {
  const supabase = await createClient();
  const answers = [...formData.entries()]
    .filter(([key]) => key.startsWith('answer_'))
    .map(([key, value]) => {
      const questionId = key.slice('answer_'.length);
      const questionType = formData.get(`type_${questionId}`) as string | null;
      return questionType === 'short_answer'
        ? { question_id: questionId, answer_text: value as string }
        : { question_id: questionId, option_id: value as string };
    });

  const { error } = await supabase.rpc('submit_course_exam', {
    p_course_id: courseId,
    p_answers: answers,
  });

  if (error) redirect(`/learn/${courseId}/exam?error=exam-failed`);
  redirect(`/learn/${courseId}/exam`);
}
