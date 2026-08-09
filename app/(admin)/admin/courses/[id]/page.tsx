import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  addLesson,
  deleteLesson,
  moveLessonDown,
  moveLessonUp,
  updateCourse,
  updateLesson,
} from '@/app/actions/admin-courses';
import Link from 'next/link';
import CourseForm from '@/components/admin/CourseForm';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { formatKstDatetimeLocal } from '@/lib/kst';
import { getAdminCourseById } from '@/lib/supabase/admin-queries';
import { getCategoryTree } from '@/lib/supabase/queries';

export const metadata: Metadata = { title: '강좌 수정 | 관리자' };

const SUCCESS_MESSAGE: Record<string, string> = {
  created: '강좌를 등록했어요. 이어서 커리큘럼을 추가해주세요.',
  updated: '수정했어요.',
  lessonAdded: '강의를 추가했어요.',
  lessonUpdated: '강의를 수정했어요.',
  lessonDeleted: '강의를 삭제했어요.',
  lessonReordered: '순서를 변경했어요.',
};

const ERROR_MESSAGE: Record<string, string> = {
  validation: '필수 항목을 확인해주세요 (slug는 영문 소문자·숫자·하이픈만 가능해요).',
  'slug-taken': '이미 사용 중인 slug예요.',
  'lesson-validation': '강의명과 영상 링크를 입력해주세요.',
  failed: '처리 중 문제가 발생했어요.',
};

export default async function AdminCourseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const [course, categories] = await Promise.all([getAdminCourseById(id), getCategoryTree()]);
  if (!course) notFound();

  const message = Object.keys(SUCCESS_MESSAGE).find((key) => search[key]);
  const errorMessage = search.error && ERROR_MESSAGE[search.error];

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <h1 className="text-[20px] font-semibold text-n-9">강좌 수정 — {course.title}</h1>

      {message && (
        <div className="rounded-md border border-success bg-success/10 px-3.5 py-3 text-[13px] font-medium text-success">
          {SUCCESS_MESSAGE[message]}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          {errorMessage}
        </div>
      )}

      <CourseForm categories={categories} action={updateCourse.bind(null, id)} defaultValues={course} submitLabel="저장" />

      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold text-n-9">커리큘럼</h2>

        {course.lessons.length === 0 ? (
          <p className="text-[13px] text-n-6">등록된 강의가 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {course.lessons.map((lesson, index) => (
              <li key={lesson.id} className="rounded-lg border border-n-3 p-3">
                <form action={updateLesson.bind(null, lesson.id, id)} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-n-5">{index + 1}강</span>
                    <input
                      name="title"
                      defaultValue={lesson.title}
                      className="h-9 flex-1 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
                    />
                  </div>
                  <input
                    name="videoUrl"
                    defaultValue={lesson.videoUrl ?? ''}
                    className="h-9 rounded-md border border-n-3 bg-n-1 px-2.5 text-[12.5px]"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 text-[12px] text-n-7">
                      <input type="checkbox" name="hasQuiz" defaultChecked={lesson.hasQuiz} className="h-3.5 w-3.5" />
                      퀴즈
                    </label>
                    <label className="flex items-center gap-1.5 text-[12px] text-n-7">
                      <input type="checkbox" name="hasAssignment" defaultChecked={lesson.hasAssignment} className="h-3.5 w-3.5" />
                      과제
                    </label>
                    <label className="flex items-center gap-1.5 text-[12px] text-n-7">
                      과제 마감기한(선택)
                      <input
                        type="datetime-local"
                        name="assignmentDueAt"
                        defaultValue={formatKstDatetimeLocal(lesson.assignmentDueAt)}
                        className="h-8 rounded-md border border-n-3 bg-n-0 px-2 text-[12px]"
                      />
                    </label>
                    <div className="flex-1" />
                    <button type="submit" className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7">
                      저장
                    </button>
                  </div>
                </form>
                <div className="mt-2 flex gap-1.5">
                  {lesson.hasQuiz && (
                    <Link
                      href={`/admin/courses/${id}/lessons/${lesson.id}/quiz`}
                      className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7"
                    >
                      퀴즈 관리
                    </Link>
                  )}
                  <form action={moveLessonUp.bind(null, lesson.id, id)}>
                    <button type="submit" className="rounded-pill border border-n-3 px-2 py-1 text-[11px] text-n-7">
                      ▲
                    </button>
                  </form>
                  <form action={moveLessonDown.bind(null, lesson.id, id)}>
                    <button type="submit" className="rounded-pill border border-n-3 px-2 py-1 text-[11px] text-n-7">
                      ▼
                    </button>
                  </form>
                  <ConfirmDialog
                    triggerLabel="삭제"
                    triggerClassName="rounded-pill border border-danger px-2.5 py-1 text-[11.5px] text-danger"
                    title="강의를 삭제할까요?"
                    description="학습자의 진도/퀴즈/과제 기록에 영향을 줄 수 있어요."
                    confirmLabel="삭제"
                    tone="danger"
                    action={deleteLesson.bind(null, lesson.id, id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <form action={addLesson.bind(null, id)} className="flex flex-col gap-2 rounded-lg border border-n-3 bg-n-1 p-3">
          <p className="text-[12.5px] font-medium text-n-7">강의 추가</p>
          <input name="title" placeholder="강의명" className="h-9 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]" />
          <input name="videoUrl" placeholder="영상 링크 (URL)" className="h-9 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]" />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px] text-n-7">
              <input type="checkbox" name="hasQuiz" className="h-3.5 w-3.5" />
              퀴즈 있음
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-n-7">
              <input type="checkbox" name="hasAssignment" className="h-3.5 w-3.5" />
              과제 있음
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-n-7">
              과제 마감기한(선택)
              <input type="datetime-local" name="assignmentDueAt" className="h-8 rounded-md border border-n-3 bg-n-0 px-2 text-[12px]" />
            </label>
            <div className="flex-1" />
            <button type="submit" className="rounded-pill bg-pink px-4 py-1.5 text-[12.5px] font-semibold text-white">
              추가
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
