'use server';

import { redirect } from 'next/navigation';
import { getClassroomAccess, getLessonById } from '@/lib/supabase/classroom-queries';
import { createClient } from '@/lib/supabase/server';

// 강의실(module-lms-5) 학습자 액션. 페이지 자체가 이미 enrollments.status==='approved'를
// 확인하지만(F-LRN-6), 서버 액션은 그 확인을 거치지 않고 직접 호출될 수 있으므로
// (security-officer 점검, 2026-08-09 — 다른 강좌의 lessonId로 진도/과제를 조작할 수 있던
// 문제) 쓰기 작업 전에 courseId-lessonId 일치 + 수강 승인 여부를 항상 재확인한다.
async function assertClassroomWriteAccess(lessonId: string, courseId: string, userId: string) {
  const lesson = await getLessonById(lessonId);
  if (!lesson || lesson.courseId !== courseId) redirect(`/learn/${courseId}?error=failed`);

  const access = await getClassroomAccess(userId, courseId);
  if (!access.allowed) redirect(`/learn/${courseId}?error=failed`);
}

// F-LRN-3: 학습 완료로 표시. 자동 완료 아님 — 사용자가 직접 눌러야 기록된다.
export async function markLessonComplete(lessonId: string, courseId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  await assertClassroomWriteAccess(lessonId, courseId, user.id);

  const { error } = await supabase
    .from('progress')
    .upsert({ user_id: user.id, lesson_id: lessonId, completed_at: new Date().toISOString() }, { onConflict: 'user_id,lesson_id' });

  if (error) redirect(`/learn/${courseId}/${lessonId}?error=failed`);
  redirect(`/learn/${courseId}/${lessonId}?completed=1`);
}

// F-LRN-4: 퀴즈 제출. formData의 answer_<questionId> 필드가 선택된 option id(라디오 그룹).
// 채점은 submit_quiz_attempt() RPC가 서버에서 auth.uid() 기준으로 수행한다(타인 명의 제출 불가).
export async function submitQuiz(lessonId: string, courseId: string, formData: FormData) {
  const supabase = await createClient();
  const selectedOptionIds = [...formData.entries()]
    .filter(([key]) => key.startsWith('answer_'))
    .map(([, value]) => value as string);

  const { data, error } = await supabase
    .rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: selectedOptionIds })
    .single();

  if (error || !data) redirect(`/learn/${courseId}/${lessonId}?error=quiz-failed`);

  const result = data as { score: number; attempt_no: number };
  redirect(`/learn/${courseId}/${lessonId}?quizScore=${result.score}&quizAttempt=${result.attempt_no}`);
}

// F-LRN-5: 과제 제출/재제출. UPDATE 권한이 없어(RLS) 재제출도 항상 새 행 insert다.
export async function submitAssignment(lessonId: string, courseId: string, formData: FormData) {
  const content = (formData.get('content') as string | null)?.trim();
  if (!content) redirect(`/learn/${courseId}/${lessonId}?error=assignment-validation`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  await assertClassroomWriteAccess(lessonId, courseId, user.id);

  const { data: lesson, error: lessonError } = await supabase
    .from('lessons')
    .select('assignment_due_at')
    .eq('id', lessonId)
    .maybeSingle();
  if (lessonError) redirect(`/learn/${courseId}/${lessonId}?error=failed`);

  const isLate = Boolean(lesson?.assignment_due_at && new Date(lesson.assignment_due_at) < new Date());

  const { error } = await supabase
    .from('assignment_submissions')
    .insert({ user_id: user.id, lesson_id: lessonId, content, is_late: isLate });

  if (error) redirect(`/learn/${courseId}/${lessonId}?error=failed`);
  redirect(`/learn/${courseId}/${lessonId}?assignmentSubmitted=1`);
}

// 수료증 자가 발급. lessonId는 배너를 보여줄 현재 강의 페이지로 되돌아가기 위함일 뿐
// (course 요약 화면이 따로 없음 — /learn/[courseId]는 첫 강의로 즉시 redirect되는 라우트).
export async function issueCertificateSelf(courseId: string, lessonId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('issue_certificate_self', { p_course_id: courseId });

  if (error) redirect(`/learn/${courseId}/${lessonId}?error=certificate-failed`);
  redirect(`/learn/${courseId}/${lessonId}?certificateIssued=1`);
}
