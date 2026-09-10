'use server';

import { redirect } from 'next/navigation';
import { requireAdminClient } from '@/lib/supabase/require-admin';
import { getCertificateCountsByCourse, getEnrollmentCountsByCourse } from '@/lib/supabase/admin-queries';
import { parseKstDatetimeLocal } from '@/lib/kst';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CourseScheduleType, CourseStatus } from '@/lib/types';

type SupabaseServerClient = SupabaseClient;

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

// courseId의 카테고리를 1Depth 조상까지 거슬러 올라가 is_certification을 확인한다
// (최대 3Depth라 최대 2번만 상위로 이동). categories 테이블 조회 실패/미존재 시 false로
// 안전하게 취급한다.
async function getCategoryIsCertification(supabase: SupabaseServerClient, categoryId: string): Promise<boolean> {
  let currentId: string | null = categoryId;
  for (let i = 0; i < 3 && currentId; i++) {
    const result = await supabase.from('categories').select('parent_id, depth, is_certification').eq('id', currentId).maybeSingle();
    const data = result.data as { parent_id: string | null; depth: number; is_certification: boolean } | null;
    if (!data) return false;
    if (data.depth === 1) return data.is_certification;
    currentId = data.parent_id;
  }
  return false;
}

async function readCourseFields(supabase: SupabaseServerClient, formData: FormData) {
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

  // 시험 관련 필드 — CourseForm이 'use client'로 카테고리 선택에 따라 실시간으로
  // 보였다 사라지는 값이라 클라이언트가 뭘 보내든 신뢰하지 않는다. 1Depth 카테고리가
  // 자격증이 아니면 서버에서 항상 false/null로 정규화한다(product-manager 확정,
  // menu-features.md F-ADMC-7~9 제약 #2 — 문항·응시 기록은 지우지 않고 게이팅만 해제).
  const isCertificationCategory = await getCategoryIsCertification(supabase, categoryId);
  let requiresExam = false;
  let examPassScore: number | null = null;
  let examMaxAttempts: number | null = null;
  if (isCertificationCategory && formData.get('requiresExam') === 'on') {
    const passScoreRaw = Number(formData.get('examPassScore'));
    const maxAttemptsRaw = Number(formData.get('examMaxAttempts'));
    if (!Number.isInteger(passScoreRaw) || passScoreRaw < 1 || passScoreRaw > 100) return null;
    if (!Number.isInteger(maxAttemptsRaw) || maxAttemptsRaw < 1) return null;
    requiresExam = true;
    examPassScore = passScoreRaw;
    examMaxAttempts = maxAttemptsRaw;
  }

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
    // 체크박스라 폼에 값이 없으면 formData.get()이 null을 반환한다 — 즉 htmlFor의 기본
    // 미체크 상태와 "필드 자체가 없음"을 구분할 수 없다. 그래서 CourseForm.tsx는 신규
    // 강좌일 때만 defaultChecked를 true로 미리 켜 둔다(기존 강좌는 전부 true였던 동작을
    // 그대로 유지). 여기서는 체크박스 값 그대로("on"이면 true) 저장한다(관리자 요청, 2026-08-29).
    requires_certificate_info: formData.get('requiresCertificateInfo') === 'on',
    requires_exam: requiresExam,
    exam_pass_score: examPassScore,
    exam_max_attempts: examMaxAttempts,
    status,
  };
}

export async function createCourse(formData: FormData) {
  const supabase = await requireAdminClient();
  const fields = await readCourseFields(supabase, formData);
  if (!fields) redirect('/admin/courses/new?error=validation');

  const { data, error } = await supabase.from('courses').insert(fields!).select('id').single();

  if (error) {
    if (error.code === '23505') redirect('/admin/courses/new?error=slug-taken');
    redirect('/admin/courses/new?error=failed');
  }
  redirect(`/admin/courses/${data!.id}?created=1`);
}

export async function updateCourse(courseId: string, formData: FormData) {
  const supabase = await requireAdminClient();
  const fields = await readCourseFields(supabase, formData);
  if (!fields) redirect(`/admin/courses/${courseId}?error=validation`);

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

  // 온라인 수업의 회의 링크(URL)는 필수가 아니다 — 강의 방식만 먼저 정하고 실제 회의
  // URL이나 오프라인 장소는 나중에 확정되는 경우가 있어, 값 없이도 방식만 저장할 수
  // 있어야 한다(관리자 요청, 2026-08-28. 기존엔 온라인 선택 시 URL을 필수로 막았었음).
  // 학습자 화면(LessonPlayer)은 이미 이 값이 없을 때 "아직 참여 링크가 등록되지
  // 않았어요"로 안전하게 대체 표시한다.

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

// ===================== 교재(주교재/보조교재) =====================
// 주교재/보조교재 모두 선택 입력 — 교재명만 있으면 등록되고, 출판사·구매 URL은 비워둘
// 수 있다(보조교재는 유인물·PPT 등 출판사·구매 URL이 아예 없는 자료도 많다는 관리자
// 요청, 2026-08-30). 주교재는 강좌당 1개만 — supabase/schema.sql의 부분 유니크
// 인덱스(course_materials_one_main_per_course)가 최종 방어선이고, 화면(admin/courses/[id])은
// 이미 주교재가 있으면 "추가" 폼 대신 수정 폼만 보여줘 애초에 두 번째를 만들 수 없게 한다.
function readCourseMaterialFields(formData: FormData) {
  const title = (formData.get('title') as string | null)?.trim();
  if (!title) return null;
  return {
    title,
    publisher: (formData.get('publisher') as string | null)?.trim() || null,
    purchase_url: (formData.get('purchaseUrl') as string | null)?.trim() || null,
  };
}

export async function addCourseMaterial(courseId: string, kind: 'main' | 'supplementary', formData: FormData) {
  const fields = readCourseMaterialFields(formData);
  if (!fields) redirect(`/admin/courses/${courseId}?error=material-validation`);

  const supabase = await requireAdminClient();
  const { count } = await supabase
    .from('course_materials')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', courseId)
    .eq('kind', kind);

  const { error } = await supabase.from('course_materials').insert({
    course_id: courseId,
    kind,
    order: count ?? 0,
    ...fields!,
  });
  if (error) {
    // 화면이 이미 막아주지만, 동시 요청 등으로 유니크 인덱스에 걸리는 경우를 대비한다.
    if (error.code === '23505') redirect(`/admin/courses/${courseId}?error=material-main-exists`);
    redirect(`/admin/courses/${courseId}?error=failed`);
  }
  redirect(`/admin/courses/${courseId}?materialAdded=1`);
}

export async function updateCourseMaterial(materialId: string, courseId: string, formData: FormData) {
  const fields = readCourseMaterialFields(formData);
  if (!fields) redirect(`/admin/courses/${courseId}?error=material-validation`);

  const supabase = await requireAdminClient();
  const { error } = await supabase.from('course_materials').update(fields!).eq('id', materialId);
  if (error) redirect(`/admin/courses/${courseId}?error=failed`);
  redirect(`/admin/courses/${courseId}?materialUpdated=1`);
}

export async function deleteCourseMaterial(materialId: string, courseId: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.from('course_materials').delete().eq('id', materialId);
  if (error) redirect(`/admin/courses/${courseId}?error=failed`);
  redirect(`/admin/courses/${courseId}?materialDeleted=1`);
}

// ===================== 강좌 복사 (2026-09-10) =====================
// 매번 새 강좌를 등록할 때마다 커리큘럼/교재/시험을 처음부터 다시 만들어야 하는 부담을
// 줄이려는 관리자 요청. 확정된 복사 범위는 "기본정보+커리큘럼+교재+시험설정 모두"
// (product-manager 확인 불필요 — 대표 직접 확정). 시험 문항의 "내용"은 이제 문제은행
// 소유라 복사하지 않고 course_exam_question_links(연결)만 복사한다 — 그러면 원본/복사본이
// 같은 문제은행 문항을 계속 공유해서 쓴다(문항을 두 번 만들 필요가 없다는 게 애초에
// 문제은행을 도입한 이유이기도 하다).
export async function duplicateCourse(courseId: string) {
  const supabase = await requireAdminClient();

  const { data: source, error: sourceError } = await supabase.from('courses').select('*').eq('id', courseId).maybeSingle();
  if (sourceError || !source) redirect('/admin/courses?error=failed');

  const {
    id: _sourceId,
    slug: sourceSlug,
    title: sourceTitle,
    created_at: _sourceCreatedAt,
    status: _sourceStatus,
    start_date: _sourceStartDate,
    end_date: _sourceEndDate,
    ...courseRest
  } = source as Record<string, unknown> & {
    id: string;
    slug: string;
    title: string;
    created_at: string;
    status: string;
    start_date: string | null;
    end_date: string | null;
  };

  // 커리큘럼·교재·시험연결을 전부 복사하는 동안 실패할 수 있어, 그 사이엔 항상
  // status='closed'(비공개)로 둔다 — qa-reviewer 지적: 처음부터 'upcoming'으로 만들면
  // 복사가 중간에 실패해도 미완성 강좌가 공개 목록(getPublicCourses)에 바로 노출된다.
  // 모든 하위 데이터 복사가 끝난 뒤에만 마지막에 'upcoming'으로 전환한다. 시작일/종료일은
  // 원본이 이미 지났을 수 있어 복사하지 않고 null로 초기화(관리자가 새로 정함).
  let newCourseId: string | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidateSlug = attempt === 0 ? `${sourceSlug}-copy` : `${sourceSlug}-copy-${attempt + 1}`;
    const { data, error } = await supabase
      .from('courses')
      .insert({
        ...courseRest,
        title: `${sourceTitle} (복사본)`,
        slug: candidateSlug,
        status: 'closed',
        start_date: null,
        end_date: null,
      })
      .select('id')
      .single();
    if (!error) {
      newCourseId = data!.id as string;
      break;
    }
    if (error.code !== '23505') redirect('/admin/courses?error=failed');
  }
  if (!newCourseId) redirect('/admin/courses?error=failed');

  // 커리큘럼(강의) 복사 — 강의별 퀴즈까지 함께 복사해야 has_quiz=true인 강의가 빈 퀴즈로
  // 남지 않는다(퀴즈는 문제은행과 달리 강의 소유 콘텐츠라 내용까지 그대로 복제해야 한다).
  const { data: lessons, error: lessonsError } = await supabase
    .from('lessons')
    .select('*')
    .eq('course_id', courseId)
    .order('order', { ascending: true });
  if (lessonsError) redirect(`/admin/courses/${newCourseId}?error=failed`);

  for (const lesson of (lessons ?? []) as Record<string, unknown>[]) {
    const {
      id: oldLessonId,
      course_id: _lessonCourseId,
      assignment_due_at: _lessonAssignmentDueAt,
      online_scheduled_at: _lessonOnlineScheduledAt,
      ...lessonRest
    } = lesson as {
      id: string;
      course_id: string;
      assignment_due_at: string | null;
      online_scheduled_at: string | null;
    };
    // 과제 마감시각/온라인 세션 일시는 원본이 이미 지났을 수 있어 복사하지 않고
    // null로 초기화한다(qa-reviewer 지적 — 그대로 복사하면 복사본이 등록 즉시
    // "이미 지난 마감일"을 갖게 됨).
    const { data: newLesson, error: newLessonError } = await supabase
      .from('lessons')
      .insert({ ...lessonRest, course_id: newCourseId, assignment_due_at: null, online_scheduled_at: null })
      .select('id')
      .single();
    if (newLessonError) redirect(`/admin/courses/${newCourseId}?error=failed`);

    const { data: questions } = await supabase
      .from('quiz_questions')
      .select('*')
      .eq('lesson_id', oldLessonId)
      .order('order', { ascending: true });

    for (const question of (questions ?? []) as Record<string, unknown>[]) {
      const { id: oldQuestionId, lesson_id: _questionLessonId, created_at: _questionCreatedAt, ...questionRest } =
        question as { id: string; lesson_id: string; created_at: string };
      const { data: newQuestion, error: newQuestionError } = await supabase
        .from('quiz_questions')
        .insert({ ...questionRest, lesson_id: newLesson!.id })
        .select('id')
        .single();
      if (newQuestionError) redirect(`/admin/courses/${newCourseId}?error=failed`);

      const { data: options } = await supabase.from('quiz_options').select('*').eq('question_id', oldQuestionId);
      if (options && options.length > 0) {
        const optionRows = (options as Record<string, unknown>[]).map((option) => {
          const { id: _optionId, question_id: _optionQuestionId, ...optionRest } = option as { id: string; question_id: string };
          return { ...optionRest, question_id: newQuestion!.id };
        });
        const { error: optionsError } = await supabase.from('quiz_options').insert(optionRows);
        if (optionsError) redirect(`/admin/courses/${newCourseId}?error=failed`);
      }
    }
  }

  // 교재(주교재/보조교재) 복사.
  const { data: materials, error: materialsError } = await supabase.from('course_materials').select('*').eq('course_id', courseId);
  if (materialsError) redirect(`/admin/courses/${newCourseId}?error=failed`);
  if (materials && materials.length > 0) {
    const materialRows = (materials as Record<string, unknown>[]).map((material) => {
      const { id: _materialId, course_id: _materialCourseId, created_at: _materialCreatedAt, ...materialRest } =
        material as { id: string; course_id: string; created_at: string };
      return { ...materialRest, course_id: newCourseId };
    });
    const { error: insertMaterialsError } = await supabase.from('course_materials').insert(materialRows);
    if (insertMaterialsError) redirect(`/admin/courses/${newCourseId}?error=failed`);
  }

  // 시험 문항 "연결" 복사 — 문항 내용은 복사하지 않고 문제은행 참조만 그대로 옮긴다.
  const { data: examLinks, error: examLinksError } = await supabase
    .from('course_exam_question_links')
    .select('bank_question_id, order')
    .eq('course_id', courseId);
  if (examLinksError) redirect(`/admin/courses/${newCourseId}?error=failed`);
  if (examLinks && examLinks.length > 0) {
    const examLinkRows = (examLinks as { bank_question_id: string; order: number }[]).map((link) => ({
      ...link,
      course_id: newCourseId,
    }));
    const { error: insertExamLinksError } = await supabase.from('course_exam_question_links').insert(examLinkRows);
    if (insertExamLinksError) redirect(`/admin/courses/${newCourseId}?error=failed`);
  }

  // 모든 하위 데이터 복사가 끝난 뒤에만 'closed' → 'upcoming'으로 전환한다(위 status='closed' 주석 참고).
  const { error: activateError } = await supabase.from('courses').update({ status: 'upcoming' }).eq('id', newCourseId);
  if (activateError) redirect(`/admin/courses/${newCourseId}?error=failed`);

  redirect(`/admin/courses/${newCourseId}?duplicated=1`);
}
