// 강의실(module-lms-5) 전용 조회 함수 모음. lib/supabase/queries.ts(공개/마이페이지)·
// admin-queries.ts(관리자)와 동일한 컨벤션(createClient() → select → camelCase 매핑 →
// error 시 throw)을 따르되, 강의실 전용 조회가 많아 파일을 분리했다.

import { createClient } from '@/lib/supabase/server';
import { getMyEnrollmentForCourse } from '@/lib/supabase/queries';
import type {
  AssignmentSubmissionStatus,
  Course,
  Lesson,
  QuizQuestionWithOptions,
} from '@/lib/types';

// ===================== 공통 매핑 =====================

type CourseRow = {
  id: string;
  slug: string;
  title: string;
  category_id: string;
  description: string;
  instructor: string;
  fee: number;
  seats: number;
  government_support: boolean;
  status: Course['status'];
};

function mapCourseRow(row: CourseRow): Course {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    categoryId: row.category_id,
    description: row.description,
    instructor: row.instructor,
    fee: row.fee,
    seats: row.seats,
    governmentSupport: row.government_support,
    status: row.status,
  };
}

type LessonRow = {
  id: string;
  course_id: string;
  title: string;
  video_url: string | null;
  order: number;
  has_quiz: boolean;
  has_assignment: boolean;
  assignment_due_at: string | null;
};

function mapLessonRow(row: LessonRow): Lesson {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    videoUrl: row.video_url,
    order: row.order,
    hasQuiz: row.has_quiz,
    hasAssignment: row.has_assignment,
    assignmentDueAt: row.assignment_due_at,
  };
}

const COURSE_COLUMNS = 'id, slug, title, category_id, description, instructor, fee, seats, government_support, status';
const LESSON_COLUMNS = 'id, course_id, title, video_url, order, has_quiz, has_assignment, assignment_due_at';

// 강의실은 공개 목록(getCourseBySlug 등)과 달리 status in ('active','upcoming') 필터를
// 걸지 않는다 — 강좌가 closed로 바뀌어도 승인된 학습자는 계속 접근해야 한다
// (courses_enrolled_select RLS가 이를 보장한다).
export async function getCourseForClassroom(courseId: string): Promise<Course | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('courses').select(COURSE_COLUMNS).eq('id', courseId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCourseRow(data as CourseRow) : null;
}

export async function getLessonsForClassroom(courseId: string): Promise<Lesson[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lessons')
    .select(LESSON_COLUMNS)
    .eq('course_id', courseId)
    .order('order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as LessonRow[]).map(mapLessonRow);
}

export async function getLessonById(lessonId: string): Promise<Lesson | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('lessons').select(LESSON_COLUMNS).eq('id', lessonId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapLessonRow(data as LessonRow) : null;
}

// F-LRN-6: 미승인 접근 차단. 기존 getMyEnrollmentForCourse(queries.ts)를 그대로 재사용한다.
export type ClassroomAccess = { allowed: true } | { allowed: false; reason: 'not-enrolled' | 'not-approved' };

export async function getClassroomAccess(userId: string, courseId: string): Promise<ClassroomAccess> {
  const enrollment = await getMyEnrollmentForCourse(userId, courseId);
  if (!enrollment) return { allowed: false, reason: 'not-enrolled' };
  if (enrollment.status !== 'approved') return { allowed: false, reason: 'not-approved' };
  return { allowed: true };
}

export async function getProgressLessonIds(userId: string, courseId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data: lessonRows, error: lessonError } = await supabase
    .from('lessons')
    .select('id')
    .eq('course_id', courseId);
  if (lessonError) throw new Error(lessonError.message);

  const lessonIds = (lessonRows as { id: string }[]).map((l) => l.id);
  if (lessonIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('progress')
    .select('lesson_id')
    .eq('user_id', userId)
    .in('lesson_id', lessonIds)
    .not('completed_at', 'is', null);
  if (error) throw new Error(error.message);

  return new Set((data as { lesson_id: string }[]).map((p) => p.lesson_id));
}

export type CourseProgressStat = { totalLessons: number; completedLessons: number };

// 여러 강좌의 진도를 한 번에 계산한다(마이페이지 수강중 탭의 N+1 방지, 수료조건 판정에도 재사용).
export async function getProgressStatsForCourses(
  userId: string,
  courseIds: string[]
): Promise<Record<string, CourseProgressStat>> {
  const stats: Record<string, CourseProgressStat> = {};
  for (const courseId of courseIds) stats[courseId] = { totalLessons: 0, completedLessons: 0 };
  if (courseIds.length === 0) return stats;

  const supabase = await createClient();
  const { data: lessonRows, error: lessonError } = await supabase
    .from('lessons')
    .select('id, course_id')
    .in('course_id', courseIds);
  if (lessonError) throw new Error(lessonError.message);

  const lessonToCourse = new Map<string, string>();
  for (const l of lessonRows as { id: string; course_id: string }[]) {
    stats[l.course_id].totalLessons += 1;
    lessonToCourse.set(l.id, l.course_id);
  }

  const lessonIds = [...lessonToCourse.keys()];
  if (lessonIds.length === 0) return stats;

  const { data: progressRows, error: progressError } = await supabase
    .from('progress')
    .select('lesson_id')
    .eq('user_id', userId)
    .in('lesson_id', lessonIds)
    .not('completed_at', 'is', null);
  if (progressError) throw new Error(progressError.message);

  for (const p of progressRows as { lesson_id: string }[]) {
    const courseId = lessonToCourse.get(p.lesson_id);
    if (courseId) stats[courseId].completedLessons += 1;
  }

  return stats;
}

export type LatestAssignmentSubmission = {
  id: string;
  status: AssignmentSubmissionStatus;
  content: string;
  isLate: boolean;
  submittedAt: string;
  reviewNote: string | null;
};

// 과제는 재제출 시 새 행을 insert한다(UPDATE 권한 없음, unique 제약 없음) — "현재 상태"는
// 항상 submitted_at이 가장 최근인 행 기준이다. lessonId별 최신 1건만 골라 Map으로 반환한다.
export async function getLatestAssignmentSubmissionsForCourse(
  userId: string,
  courseId: string
): Promise<Map<string, LatestAssignmentSubmission>> {
  const supabase = await createClient();
  const { data: lessonRows, error: lessonError } = await supabase
    .from('lessons')
    .select('id')
    .eq('course_id', courseId);
  if (lessonError) throw new Error(lessonError.message);

  const lessonIds = (lessonRows as { id: string }[]).map((l) => l.id);
  const result = new Map<string, LatestAssignmentSubmission>();
  if (lessonIds.length === 0) return result;

  const { data, error } = await supabase
    .from('assignment_submissions')
    .select('id, lesson_id, status, content, is_late, submitted_at, review_note')
    .eq('user_id', userId)
    .in('lesson_id', lessonIds)
    .order('submitted_at', { ascending: false });
  if (error) throw new Error(error.message);

  for (const row of data as {
    id: string;
    lesson_id: string;
    status: AssignmentSubmissionStatus;
    content: string;
    is_late: boolean;
    submitted_at: string;
    review_note: string | null;
  }[]) {
    if (!result.has(row.lesson_id)) {
      result.set(row.lesson_id, {
        id: row.id,
        status: row.status,
        content: row.content,
        isLate: row.is_late,
        submittedAt: row.submitted_at,
        reviewNote: row.review_note,
      });
    }
  }

  return result;
}

export async function getQuizForLesson(lessonId: string): Promise<QuizQuestionWithOptions[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_quiz_for_lesson', { p_lesson_id: lessonId });
  if (error) throw new Error(error.message);

  const rows = data as {
    question_id: string;
    question: string;
    question_order: number;
    option_id: string;
    option_label: string;
    option_order: number;
  }[];

  const questions = new Map<string, QuizQuestionWithOptions>();
  for (const row of rows) {
    if (!questions.has(row.question_id)) {
      questions.set(row.question_id, { id: row.question_id, question: row.question, order: row.question_order, options: [] });
    }
    questions.get(row.question_id)!.options.push({ id: row.option_id, label: row.option_label, order: row.option_order });
  }

  return [...questions.values()].sort((a, b) => a.order - b.order);
}

export type QuizAttempt = { id: string; score: number; attemptNo: number; submittedAt: string };

export async function getQuizAttemptHistory(userId: string, lessonId: string): Promise<QuizAttempt[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('quiz_submissions')
    .select('id, score, attempt_no, submitted_at')
    .eq('user_id', userId)
    .eq('lesson_id', lessonId)
    .order('attempt_no', { ascending: false });
  if (error) throw new Error(error.message);

  return (data as { id: string; score: number; attempt_no: number; submitted_at: string }[]).map((r) => ({
    id: r.id,
    score: r.score,
    attemptNo: r.attempt_no,
    submittedAt: r.submitted_at,
  }));
}

export type CertificateEligibility = {
  eligible: boolean;
  alreadyIssued: boolean;
  totalLessons: number;
  completedLessons: number;
  pendingAssignmentLessonTitles: string[];
};

// UI 표시 전용(버튼 활성화 여부 + "부족한 항목" 안내) — 실제 발급 게이트는
// issue_certificate_self() RPC가 서버에서 독립적으로 재검증하므로, 이 함수와 RPC의 판정이
// 어긋나도 보안/정합성 문제가 되지 않는다(최악의 경우 버튼 상태가 잠깐 부정확할 뿐).
export async function getCertificateEligibilityForCourse(userId: string, courseId: string): Promise<CertificateEligibility> {
  const supabase = await createClient();

  const [lessons, statsByCourse, latestAssignments, certRes] = await Promise.all([
    getLessonsForClassroom(courseId),
    getProgressStatsForCourses(userId, [courseId]),
    getLatestAssignmentSubmissionsForCourse(userId, courseId),
    supabase.from('certificates').select('id').eq('user_id', userId).eq('course_id', courseId).maybeSingle(),
  ]);
  if (certRes.error) throw new Error(certRes.error.message);

  const stats = statsByCourse[courseId];
  const pendingAssignmentLessonTitles = lessons
    .filter((l) => l.hasAssignment && latestAssignments.get(l.id)?.status !== 'approved')
    .map((l) => l.title);

  const alreadyIssued = certRes.data !== null;
  const eligible =
    !alreadyIssued &&
    stats.totalLessons > 0 &&
    stats.completedLessons === stats.totalLessons &&
    pendingAssignmentLessonTitles.length === 0;

  return {
    eligible,
    alreadyIssued,
    totalLessons: stats.totalLessons,
    completedLessons: stats.completedLessons,
    pendingAssignmentLessonTitles,
  };
}

export type MyCertificate = { id: string; courseId: string; courseTitle: string; issuedAt: string; fileUrl: string | null };

export async function getMyCertificatesWithCourse(userId: string): Promise<MyCertificate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('certificates')
    .select('id, course_id, issued_at, file_url, courses(title)')
    .eq('user_id', userId)
    .order('issued_at', { ascending: false });
  if (error) throw new Error(error.message);

  return (
    data as unknown as { id: string; course_id: string; issued_at: string; file_url: string | null; courses: { title: string } }[]
  ).map((row) => ({
    id: row.id,
    courseId: row.course_id,
    courseTitle: row.courses.title,
    issuedAt: row.issued_at,
    fileUrl: row.file_url,
  }));
}

export type CompletedEnrollment = { courseId: string; courseTitle: string; courseSlug: string };

// F-MY-3 "완료" 탭: 진도 100% 강좌(수료증 발급 여부와 무관 — menu-features.md 정의상
// "완료"와 "수료증"은 서로 독립된 탭이다).
export async function getCompletedEnrollmentsForUser(userId: string): Promise<CompletedEnrollment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('enrollments')
    .select('course_id, courses(title, slug)')
    .eq('user_id', userId)
    .eq('status', 'approved');
  if (error) throw new Error(error.message);

  const rows = data as unknown as { course_id: string; courses: { title: string; slug: string } }[];
  if (rows.length === 0) return [];

  const stats = await getProgressStatsForCourses(
    userId,
    rows.map((r) => r.course_id)
  );

  return rows
    .filter((r) => {
      const s = stats[r.course_id];
      return s.totalLessons > 0 && s.completedLessons === s.totalLessons;
    })
    .map((r) => ({ courseId: r.course_id, courseTitle: r.courses.title, courseSlug: r.courses.slug }));
}

// Q12 강화판(회원탈퇴 차단 조건): 예전에는 approved 신청을 전부 "진행 중"으로 간주해,
// 강좌를 끝까지 수료(진도 100%)한 학습자도 영원히 탈퇴할 수 없는 문제가 있었다
// (qa-reviewer 점검, 2026-08-09 — module-lms-4는 module-lms-5의 "완료" 개념이 생기기
// 전에 작성된 로직이었다). approved 건은 진도가 아직 100%가 아닐 때만 탈퇴를 막도록
// 강화한다. 순환 참조를 피하기 위해 queries.ts를 고치는 대신 이 파일(진도 데이터를
// 이미 다루는 곳)에 새 함수로 둔다.
export async function hasIncompleteApprovedEnrollment(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('enrollments')
    .select('course_id, status')
    .eq('user_id', userId)
    .or(`status.eq.approved,and(status.eq.pending,payment_due_at.gte.${nowIso})`);
  if (error) throw new Error(error.message);

  const rows = data as { course_id: string; status: string }[];
  if (rows.some((r) => r.status === 'pending')) return true;

  const approvedCourseIds = rows.filter((r) => r.status === 'approved').map((r) => r.course_id);
  if (approvedCourseIds.length === 0) return false;

  const stats = await getProgressStatsForCourses(userId, approvedCourseIds);
  return approvedCourseIds.some((id) => stats[id].totalLessons === 0 || stats[id].completedLessons < stats[id].totalLessons);
}
