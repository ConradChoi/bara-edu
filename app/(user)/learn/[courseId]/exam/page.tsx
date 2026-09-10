import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import ClassroomAccessNotice from '@/components/classroom/ClassroomAccessNotice';
import CurriculumSidebar from '@/components/classroom/CurriculumSidebar';
import ExamForm from '@/components/classroom/ExamForm';
import { siteConfig } from '@/data/site-config';
import { formatKstDisplay } from '@/lib/kst';
import {
  getClassroomAccess,
  getCourseExamQuestions,
  getCourseExamState,
  getCourseForClassroom,
  getLessonsForClassroom,
  getProgressLessonIds,
} from '@/lib/supabase/classroom-queries';
import { getCourseMaterialsForCourse } from '@/lib/supabase/queries';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata({ params }: { params: Promise<{ courseId: string }> }): Promise<Metadata> {
  const { courseId } = await params;
  const course = await getCourseForClassroom(courseId);
  return { title: course ? `자격시험 | ${course.title}` : '자격시험' };
}

const ERROR_MESSAGE: Record<string, string> = {
  'exam-failed': '제출에 실패했어요. 다시 시도해주세요.',
};

export default async function CourseExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { courseId } = await params;
  const { error } = await searchParams;

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

  // 사이드바에 진입 링크 자체가 requiresExam=true인 강좌에서만 생기므로, 정상 경로로는
  // false인 강좌의 이 URL에 도달할 수 없다 — 직접 접근 시 404.
  if (!course.requiresExam) notFound();

  const [lessons, completedLessonIds, materials, examState] = await Promise.all([
    getLessonsForClassroom(courseId),
    getProgressLessonIds(user.id, courseId),
    getCourseMaterialsForCourse(courseId),
    getCourseExamState(user.id, courseId),
  ]);
  if (!examState) notFound();

  const questions = examState.status === 'available' ? await getCourseExamQuestions(courseId) : [];
  const errorMessage = error && ERROR_MESSAGE[error];
  const digitsOnlyPhone = siteConfig.phone.replace(/[^0-9]/g, '');

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-6 py-8 md:flex-row">
      <CurriculumSidebar
        lessons={lessons}
        completedLessonIds={completedLessonIds}
        courseId={courseId}
        currentLessonId=""
        materials={materials}
        examStatus={examState.status}
      />

      <div className="flex flex-1 flex-col gap-5">
        <h1 className="text-[20px] font-semibold text-n-9">자격시험</h1>

        {errorMessage && (
          <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
            {errorMessage}
          </div>
        )}

        {examState.status === 'locked' && (
          <div className="flex flex-col gap-1">
            <p className="text-[14px] text-n-7">모든 강의와 과제를 마치면 응시할 수 있어요</p>
            <button
              type="button"
              disabled
              className="mt-2 self-start rounded-pill bg-n-3 px-4 py-2 text-[13px] font-medium text-n-6 disabled:cursor-not-allowed"
            >
              시험 응시하기
            </button>
            <p className="mt-1 text-[11.5px] text-n-5">
              진도 {examState.completedLessons}/{examState.totalLessons}
              {examState.pendingAssignmentLessonTitles.length > 0 &&
                ` · 과제 승인 대기: ${examState.pendingAssignmentLessonTitles.join(', ')}`}
            </p>
          </div>
        )}

        {examState.status === 'not_ready' && (
          <div className="flex flex-col gap-1">
            <p className="text-[15px] font-semibold text-n-9">시험을 준비하고 있어요</p>
            <p className="text-[13px] text-n-6">문항이 등록되면 응시할 수 있어요. 잠시만 기다려 주세요.</p>
          </div>
        )}

        {examState.status === 'available' && (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-n-6">
              합격 기준 {examState.examPassScore}% · 남은 응시 횟수 {examState.remainingAttempts}회
              {examState.lastScore !== null && ` · 지난 응시: ${examState.lastScore}점 (불합격)`}
            </p>
            {questions.length > 0 ? (
              <ExamForm courseId={courseId} questions={questions} />
            ) : (
              <p className="text-[13px] text-n-6">문항을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.</p>
            )}
          </div>
        )}

        {examState.status === 'passed' && (
          <div className="flex flex-col gap-1">
            <p className="text-[15px] font-semibold text-n-9">합격했어요</p>
            <p className="text-[13px] text-n-6">
              {examState.passedScore}점 · {formatKstDisplay(examState.passedAt)}
            </p>
            <Link
              href={lessons[0] ? `/learn/${courseId}/${lessons[0].id}` : `/my`}
              className="mt-2 self-start text-[12.5px] font-medium text-pink underline"
            >
              강의실로 돌아가 수료증 확인하기
            </Link>
          </div>
        )}

        {examState.status === 'exhausted' && (
          <div className="flex flex-col gap-2">
            <p className="text-[15px] font-semibold text-n-9">재응시 횟수를 모두 사용했어요</p>
            <p className="text-[13px] text-n-7">
              최근 점수 {examState.lastScore}점 · 합격 기준 {examState.examPassScore}%. 담당자에게 문의하면 재응시 기회를 다시 받을 수
              있어요.
            </p>
            <div className="mt-1 flex gap-4">
              <a href={`tel:${digitsOnlyPhone}`} className="text-[13px] font-medium text-indigo hover:underline">
                전화 문의 {siteConfig.phone}
              </a>
              <a href={`mailto:${siteConfig.email}`} className="text-[13px] font-medium text-indigo hover:underline">
                이메일 문의
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
