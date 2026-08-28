'use server';

import { redirect } from 'next/navigation';
import { requireAdminClient } from '@/lib/supabase/require-admin';
import { getCertificateCountsByCourse, getEnrollmentCountsByCourse } from '@/lib/supabase/admin-queries';
import { parseKstDatetimeLocal } from '@/lib/kst';
import type { CourseScheduleType, CourseStatus } from '@/lib/types';

// 강좌 관리 (F-ADMC-1~4). category_id/course_id FK에 ON DELETE 절이 없어 참조가 있는
// 상태로 삭제를 시도하면 raw FK 에러(23503)가 난다 — 미리 참조 건수를 확인해 친절한
// 안내로 대체한다(이게 원래 와이어프레임의 "확인 다이얼로그" 의도이기도 하다).

const SCHEDULE_TYPES = ['weekday', 'weekend', 'both'] as const;

// <input type="date">는 시간 정보가 없는 순수 달력 날짜("YYYY-MM-DD")라 KST 변환이
// 필요 없다(assignment_due_at의 datetime-local과 다름). 유효하지 않은 값이면 undefined.
function readOptionalDateField(formData: FormData, name: string): string | null | undefined {
  const raw = (formData.get(name) as string | null)?.trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) return undefined;
  return raw;
}

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

  // 총 강좌 시간은 선택 입력 — 비워두면 null(표시 생략), 입력하면 fee/seats와 같은 기준으로 검증한다.
  const totalHoursRaw = (formData.get('totalHours') as string | null)?.trim();
  let totalHours: number | null = null;
  if (totalHoursRaw) {
    const parsed = Number(totalHoursRaw);
    if (!Number.isInteger(parsed) || parsed < 0) return null;
    totalHours = parsed;
  }

  // 시작일/종료일 둘 다 선택 입력.
  const startDate = readOptionalDateField(formData, 'startDate');
  const endDate = readOptionalDateField(formData, 'endDate');
  if (startDate === undefined || endDate === undefined) return null;
  if (startDate && endDate && endDate < startDate) return null;

  // 평일반/주말반/평일+주말반도 선택 입력.
  const scheduleTypeRaw = (formData.get('scheduleType') as string | null) || '';
  const scheduleType: CourseScheduleType | null = SCHEDULE_TYPES.includes(
    scheduleTypeRaw as (typeof SCHEDULE_TYPES)[number]
  )
    ? (scheduleTypeRaw as CourseScheduleType)
    : null;

  return {
    title,
    slug,
    category_id: categoryId,
    description: ((formData.get('description') as string | null) ?? '').trim(),
    instructor: ((formData.get('instructor') as string | null) ?? '').trim(),
    fee,
    seats,
    total_hours: totalHours,
    start_date: startDate,
    end_date: endDate,
    schedule_type: scheduleType,
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
//
// 강의 방식(lessonMode)별로 관련 없는 필드는 저장하지 않고 null로 비운다 — 관리자가
// 온라인→영상으로 모드를 바꿔도 예전 회의 링크가 DB에 남아있지 않게 하기 위함
// (관리자 요청, 2026-08-25: 강의 방식 select 신규 추가).
const LESSON_MODES = ['video', 'online', 'offline'] as const;

function readLessonFields(formData: FormData) {
  const title = (formData.get('title') as string | null)?.trim();
  if (!title) return null;

  const rawMode = formData.get('lessonMode') as string | null;
  const lessonMode = LESSON_MODES.includes(rawMode as (typeof LESSON_MODES)[number])
    ? (rawMode as (typeof LESSON_MODES)[number])
    : 'video';

  const videoUrl = (formData.get('videoUrl') as string | null)?.trim() || null;
  const onlineMeetingUrl = (formData.get('onlineMeetingUrl') as string | null)?.trim() || null;
  const onlineScheduledAt = parseKstDatetimeLocal(formData.get('onlineScheduledAt') as string | null);
  const offlineLocationName = (formData.get('offlineLocationName') as string | null)?.trim() || null;
  const offlineAddress = (formData.get('offlineAddress') as string | null)?.trim() || null;

  // 온라인 수업은 회의 참여 링크가 없으면 학습자가 아무것도 할 수 없어 필수로 막는다
  // (관리자 확정, 2026-08-25). 오프라인 수업의 장소명/주소는 선택 입력.
  if (lessonMode === 'online' && !onlineMeetingUrl) return null;

  return {
    title,
    video_url: lessonMode === 'video' ? videoUrl : null,
    lesson_mode: lessonMode,
    online_meeting_url: lessonMode === 'online' ? onlineMeetingUrl : null,
    online_scheduled_at: lessonMode === 'online' ? onlineScheduledAt : null,
    offline_location_name: lessonMode === 'offline' ? offlineLocationName : null,
    offline_address: lessonMode === 'offline' ? offlineAddress : null,
    has_quiz: formData.get('hasQuiz') === 'on',
    has_assignment: formData.get('hasAssignment') === 'on',
    assignment_due_at: parseKstDatetimeLocal(formData.get('assignmentDueAt') as string | null),
  };
}

export async function addLesson(courseId: string, formData: FormData) {
  const fields = readLessonFields(formData);
  if (!fields) redirect(`/admin/courses/${courseId}?error=lesson-validation`);

  const supabase = await requireAdminClient();
  const { count } = await supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('course_id', courseId);

  const { error } = await supabase.from('lessons').insert({
    course_id: courseId,
    order: (count ?? 0) + 1,
    ...fields!,
  });
  if (error) redirect(`/admin/courses/${courseId}?error=failed`);
  redirect(`/admin/courses/${courseId}?lessonAdded=1`);
}

export async function updateLesson(lessonId: string, courseId: string, formData: FormData) {
  const fields = readLessonFields(formData);
  if (!fields) redirect(`/admin/courses/${courseId}?error=lesson-validation`);

  const supabase = await requireAdminClient();
  const { error } = await supabase.from('lessons').update(fields!).eq('id', lessonId);
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
