import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import AssignmentForm from '@/components/classroom/AssignmentForm';
import CertificateAction from '@/components/classroom/CertificateAction';
import ClassroomAccessNotice from '@/components/classroom/ClassroomAccessNotice';
import CurriculumSidebar from '@/components/classroom/CurriculumSidebar';
import LessonPlayer from '@/components/classroom/LessonPlayer';
import MarkCompleteButton from '@/components/classroom/MarkCompleteButton';
import QuizForm from '@/components/classroom/QuizForm';
import QuizResult from '@/components/classroom/QuizResult';
import {
  getCertificateEligibilityForCourse,
  getClassroomAccess,
  getCourseForClassroom,
  getLatestAssignmentSubmissionsForCourse,
  getLessonsForClassroom,
  getProgressLessonIds,
  getQuizAttemptHistory,
  getQuizForLesson,
} from '@/lib/supabase/classroom-queries';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ courseId: string; lessonId: string }>;
}): Promise<Metadata> {
  const { courseId } = await params;
  const course = await getCourseForClassroom(courseId);
  return { title: course ? `강의실 | ${course.title}` : '강의실' };
}

const ERROR_MESSAGE: Record<string, string> = {
  failed: '처리 중 문제가 발생했어요.',
  'quiz-failed': '퀴즈 제출에 실패했어요.',
  'assignment-validation': '과제 내용을 입력해주세요.',
  'certificate-failed': '아직 수료증을 발급받을 수 없어요.',
};

export default async function ClassroomLessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; lessonId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { courseId, lessonId } = await params;
  const search = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const course = await getCourseForClassroom(courseId);
  if (!course) notFound();

  const access = await getClassroomAccess(user.id, courseId);
  if (!access.allowed) {
    return <ClassroomAccessNotice reason={access.reason} />;
  }

  const lessons = await getLessonsForClassroom(courseId);
  const currentLesson = lessons.find((l) => l.id === lessonId);
  if (!currentLesson) notFound();

  const [completedLessonIds, latestAssignments, eligibility] = await Promise.all([
    getProgressLessonIds(user.id, courseId),
    getLatestAssignmentSubmissionsForCourse(user.id, courseId),
    getCertificateEligibilityForCourse(user.id, courseId),
  ]);

  const quizQuestions = currentLesson.hasQuiz ? await getQuizForLesson(currentLesson.id) : [];
  const quizAttempts = currentLesson.hasQuiz ? await getQuizAttemptHistory(user.id, currentLesson.id) : [];

  const errorMessage = search.error && ERROR_MESSAGE[search.error];
  const latestAssignment = latestAssignments.get(currentLesson.id) ?? null;

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-6 py-8 md:flex-row">
      <CurriculumSidebar
        lessons={lessons}
        completedLessonIds={completedLessonIds}
        courseId={courseId}
        currentLessonId={currentLesson.id}
      />

      <div className="flex flex-1 flex-col gap-5">
        <h1 className="text-[17px] font-semibold text-n-9">{currentLesson.title}</h1>

        {errorMessage && (
          <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
            {errorMessage}
          </div>
        )}
        {search.completed && (
          <div className="rounded-md border border-success bg-success/10 px-3.5 py-3 text-[13px] font-medium text-success">
            학습 완료로 표시했어요.
          </div>
        )}
        {search.assignmentSubmitted && (
          <div className="rounded-md border border-success bg-success/10 px-3.5 py-3 text-[13px] font-medium text-success">
            과제를 제출했어요. 검토 후 결과가 반영돼요.
          </div>
        )}
        {search.certificateIssued && (
          <div className="rounded-md border border-success bg-success/10 px-3.5 py-3 text-[13px] font-medium text-success">
            수료증이 발급됐어요! 마이페이지에서 확인하세요.
          </div>
        )}

        <LessonPlayer videoUrl={currentLesson.videoUrl} />
        <MarkCompleteButton
          lessonId={currentLesson.id}
          courseId={courseId}
          alreadyCompleted={completedLessonIds.has(currentLesson.id)}
        />

        {currentLesson.hasQuiz && (
          <section className="flex flex-col gap-3 border-t border-n-2 pt-5">
            <h2 className="text-[14px] font-semibold text-n-9">퀴즈</h2>
            {search.quizScore && (
              <QuizResult score={Number(search.quizScore)} attemptNo={Number(search.quizAttempt ?? 1)} />
            )}
            {quizQuestions.length > 0 ? (
              <QuizForm lessonId={currentLesson.id} courseId={courseId} questions={quizQuestions} />
            ) : (
              <p className="text-[13px] text-n-6">아직 등록된 문제가 없어요.</p>
            )}
            {quizAttempts.length > 0 && (
              <details className="text-[12px] text-n-6">
                <summary className="cursor-pointer">이전 응시 기록 ({quizAttempts.length}회)</summary>
                <ul className="mt-1.5 flex flex-col gap-0.5 pl-4">
                  {quizAttempts.map((a) => (
                    <li key={a.id}>
                      {a.attemptNo}회차 · {a.score}점 · {new Date(a.submittedAt).toLocaleDateString('ko-KR')}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}

        {currentLesson.hasAssignment && (
          <section className="flex flex-col gap-3 border-t border-n-2 pt-5">
            <h2 className="text-[14px] font-semibold text-n-9">과제</h2>
            <AssignmentForm lessonId={currentLesson.id} courseId={courseId} latest={latestAssignment} />
          </section>
        )}

        <section className="flex flex-col gap-2 border-t border-n-2 pt-5">
          <h2 className="text-[14px] font-semibold text-n-9">수료증</h2>
          <CertificateAction courseId={courseId} lessonId={currentLesson.id} eligibility={eligibility} />
        </section>
      </div>
    </div>
  );
}
