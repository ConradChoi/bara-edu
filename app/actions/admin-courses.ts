'use server';

import { redirect } from 'next/navigation';
import { requireAdminClient } from '@/lib/supabase/require-admin';
import { getCertificateCountsByCourse, getEnrollmentCountsByCourse } from '@/lib/supabase/admin-queries';
import { parseKstDatetimeLocal } from '@/lib/kst';
import type { CourseStatus } from '@/lib/types';

// 강좌 관리 (F-ADMC-1~4). category_id/course_id FK에 ON DELETE 절이 없어 참조가 있는
// 상태로 삭제를 시도하면 raw FK 에러(23503)가 난다 — 미리 참조 건수를 확인해 친절한
// 안내로 대체한다(이게 원래 와이어프레임의 "확인 다이얼로그" 의도이기도 하다).

function readCourseFields(formData: FormData) {
  const title = (formData.get('title') as string | null)?.trim();
  const slug = (formData.get('slug') as string | null)?.trim();
  const categoryId = (formData.get('categoryId') as string | null) || null;
  const fee = Number(formData.get('fee'));
  const seats = Number(formData.get('seats'));
  const status = (formData.get('status') as string | null) as CourseStatus | null;

  if (!title || !slug || !categoryId || !status) return null;
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  // fee/seats는 DB에서 integer 컬럼이라 정수인지까지 확인한다(qa-reviewer 점검, 2026-08-08).
  if (!Number.isInteger(fee) || fee < 0 || !Number.isInteger(seats) || seats < 0) return null;

  return {
    title,
    slug,
    category_id: categoryId,
    description: ((formData.get('description') as string | null) ?? '').trim(),
    instructor: ((formData.get('instructor') as string | null) ?? '').trim(),
    fee,
    seats,
    government_support: formData.get('governmentSupport') === 'on',
    status,
  };
}

export async function createCourse(formData: FormData) {
  const fields = readCourseFields(formData);
  if (!fields) redirect('/admin/courses/new?error=validation');

  const supabase = await requireAdminClient();
  const { data, error } = await supabase.from('courses').insert(fields!).select('id').single();

  if (error) {
    if (error.code === '23505') redirect('/admin/courses/new?error=slug-taken');
    redirect('/admin/courses/new?error=failed');
  }
  redirect(`/admin/courses/${data!.id}?created=1`);
}

export async function updateCourse(courseId: string, formData: FormData) {
  const fields = readCourseFields(formData);
  if (!fields) redirect(`/admin/courses/${courseId}?error=validation`);

  const supabase = await requireAdminClient();
  const { error } = await supabase.from('courses').update(fields!).eq('id', courseId);

  if (error) {
    if (error.code === '23505') redirect(`/admin/courses/${courseId}?error=slug-taken`);
    redirect(`/admin/courses/${courseId}?error=failed`);
  }
  redirect(`/admin/courses/${courseId}?updated=1`);
}

export async function deactivateCourse(courseId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.from('courses').update({ status: 'closed' }).eq('id', courseId);
  if (error) redirect('/admin/courses?error=failed');
  redirect('/admin/courses?success=deactivated');
}

export async function deleteCourse(courseId: string) {
  const [enrollmentCounts, certificateCounts] = await Promise.all([
    getEnrollmentCountsByCourse([courseId]),
    getCertificateCountsByCourse([courseId]),
  ]);
  if ((enrollmentCounts[courseId] ?? 0) > 0 || (certificateCounts[courseId] ?? 0) > 0) {
    redirect('/admin/courses?error=has-history');
  }

  const supabase = await requireAdminClient();
  const { error } = await supabase.from('courses').delete().eq('id', courseId);
  if (error) redirect('/admin/courses?error=failed');
  redirect('/admin/courses?success=deleted');
}

// ===================== 커리큘럼(강의) =====================

// videoUrl은 선택값이다 — Lesson.videoUrl이 nullable이고 LessonPlayer도 "등록된 영상이
// 없어요" 빈 상태를 지원하므로, 관리자가 영상 링크를 나중에 등록할 수 있게 허용한다
// (qa-reviewer 점검, 2026-08-09: 필수로 막아두면 그 빈 상태가 죽은 코드가 됨).
export async function addLesson(courseId: string, formData: FormData) {
  const title = (formData.get('title') as string | null)?.trim();
  const videoUrl = (formData.get('videoUrl') as string | null)?.trim() || null;
  if (!title) redirect(`/admin/courses/${courseId}?error=lesson-validation`);

  const supabase = await requireAdminClient();
  const { count } = await supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('course_id', courseId);

  const { error } = await supabase.from('lessons').insert({
    course_id: courseId,
    title,
    video_url: videoUrl,
    order: (count ?? 0) + 1,
    has_quiz: formData.get('hasQuiz') === 'on',
    has_assignment: formData.get('hasAssignment') === 'on',
    assignment_due_at: parseKstDatetimeLocal(formData.get('assignmentDueAt') as string | null),
  });
  if (error) redirect(`/admin/courses/${courseId}?error=failed`);
  redirect(`/admin/courses/${courseId}?lessonAdded=1`);
}

export async function updateLesson(lessonId: string, courseId: string, formData: FormData) {
  const title = (formData.get('title') as string | null)?.trim();
  const videoUrl = (formData.get('videoUrl') as string | null)?.trim() || null;
  if (!title) redirect(`/admin/courses/${courseId}?error=lesson-validation`);

  const supabase = await requireAdminClient();
  const { error } = await supabase
    .from('lessons')
    .update({
      title,
      video_url: videoUrl,
      has_quiz: formData.get('hasQuiz') === 'on',
      has_assignment: formData.get('hasAssignment') === 'on',
      assignment_due_at: parseKstDatetimeLocal(formData.get('assignmentDueAt') as string | null),
    })
    .eq('id', lessonId);
  if (error) redirect(`/admin/courses/${courseId}?error=failed`);
  redirect(`/admin/courses/${courseId}?lessonUpdated=1`);
}

export async function deleteLesson(lessonId: string, courseId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.from('lessons').delete().eq('id', lessonId);
  if (error) redirect(`/admin/courses/${courseId}?error=failed`);
  redirect(`/admin/courses/${courseId}?lessonDeleted=1`);
}

async function swapLessonOrder(lessonId: string, courseId: string, direction: 'up' | 'down') {
  const supabase = await requireAdminClient();
  const { data: siblings, error } = await supabase
    .from('lessons')
    .select('id, order')
    .eq('course_id', courseId)
    .order('order', { ascending: true });
  if (error || !siblings) redirect(`/admin/courses/${courseId}?error=failed`);

  const idx = siblings!.findIndex((l) => l.id === lessonId);
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= siblings!.length) redirect(`/admin/courses/${courseId}`);

  const current = siblings![idx];
  const target = siblings![targetIdx];
  await supabase.from('lessons').update({ order: target.order }).eq('id', lessonId);
  await supabase.from('lessons').update({ order: current.order }).eq('id', target.id);
  redirect(`/admin/courses/${courseId}?lessonReordered=1`);
}

export async function moveLessonUp(lessonId: string, courseId: string) {
  await swapLessonOrder(lessonId, courseId, 'up');
}

export async function moveLessonDown(lessonId: string, courseId: string) {
  await swapLessonOrder(lessonId, courseId, 'down');
}
