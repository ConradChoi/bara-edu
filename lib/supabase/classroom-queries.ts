// 강의실(module-lms-5) 전용 조회 함수 모음. lib/supabase/queries.ts(공개/마이페이지)·
// admin-queries.ts(관리자)와 동일한 컨벤션(createClient() → select → camelCase 매핑 →
// error 시 throw)을 따르되, 강의실 전용 조회가 많아 파일을 분리했다.

import { COURSE_COLUMNS, getMyEnrollmentForCourse, mapCourseRow, type CourseRow } from '@/lib/supabase/queries';
import { createClient } from '@/lib/supabase/server';
import type {
  AssignmentSubmissionStatus,
  Course,
  CourseExamQuestionWithOptions,
  CourseExamStatus,
  Lesson,
  QuizQuestionWithOptions,
} from '@/lib/types';

// ===================== 공통 매핑 =====================
// courses 관련 타입/매핑(CourseRow/mapCourseRow/COURSE_COLUMNS)은 lib/supabase/queries.ts가
// canonical source다(2026-09-10, 3파일 중복 동기화 기술부채 해소).

type LessonRow = {
  id: string;
  course_id: string;
  title: string;
  video_url: string | null;
  order: number;
  has_quiz: boolean;
  has_assignment: boolean;
  assignment_due_at: string | null;
  lesson_mode: Lesson['lessonMode'];
  online_meeting_url: string | null;
  online_scheduled_at: string | null;
  offline_location_name: string | null;
  offline_address: string | null;
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
    lessonMode: row.lesson_mode,
    onlineMeetingUrl: row.online_meeting_url,
    onlineScheduledAt: row.online_scheduled_at,
    offlineLocationName: row.offline_location_name,
    offlineAddress: row.offline_address,
  };
}

const LESSON_COLUMNS =
  'id, course_id, title, video_url, order, has_quiz, has_assignment, assignment_due_at, lesson_mode, online_meeting_url, online_scheduled_at, offline_location_name, offline_address';

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
  examRequired: boolean;
  examPassed: boolean; // examRequired=false면 항상 true(eligible 산식 단순화용)
};

// UI 표시 전용(버튼 활성화 여부 + "부족한 항목" 안내) — 실제 발급 게이트는
// issue_certificate_self() RPC가 서버에서 독립적으로 재검증하므로, 이 함수와 RPC의 판정이
// 어긋나도 보안/정합성 문제가 되지 않는다(최악의 경우 버튼 상태가 잠깐 부정확할 뿐).
export async function getCertificateEligibilityForCourse(userId: string, courseId: string): Promise<CertificateEligibility> {
  const supabase = await createClient();

  const [course, lessons, statsByCourse, latestAssignments, certRes, examPassedRes] = await Promise.all([
    getCourseForClassroom(courseId),
    getLessonsForClassroom(courseId),
    getProgressStatsForCourses(userId, [courseId]),
    getLatestAssignmentSubmissionsForCourse(userId, courseId),
    supabase.from('certificates').select('id').eq('user_id', userId).eq('course_id', courseId).maybeSingle(),
    supabase
      .from('course_exam_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('course_id', courseId)
      .eq('passed', true),
  ]);
  if (certRes.error) throw new Error(certRes.error.message);
  if (examPassedRes.error) throw new Error(examPassedRes.error.message);

  const stats = statsByCourse[courseId];
  const pendingAssignmentLessonTitles = lessons
    .filter((l) => l.hasAssignment && latestAssignments.get(l.id)?.status !== 'approved')
    .map((l) => l.title);

  const examRequired = course?.requiresExam ?? false;
  const examPassed = !examRequired || (examPassedRes.count ?? 0) > 0;

  const alreadyIssued = certRes.data !== null;
  const eligible =
    !alreadyIssued &&
    stats.totalLessons > 0 &&
    stats.completedLessons === stats.totalLessons &&
    pendingAssignmentLessonTitles.length === 0 &&
    examPassed;

  return {
    eligible,
    alreadyIssued,
    totalLessons: stats.totalLessons,
    completedLessons: stats.completedLessons,
    pendingAssignmentLessonTitles,
    examRequired,
    examPassed,
  };
}

// ===================== 자격시험(Course Exam, 2026-09-09) =====================

export type CourseExamState = {
  status: CourseExamStatus;
  completedLessons: number;
  totalLessons: number;
  pendingAssignmentLessonTitles: string[];
  examPassScore: number | null;
  examMaxAttempts: number | null;
  remainingAttempts: number | null; // 'available'일 때만 값 존재
  lastScore: number | null;
  passedScore: number | null;
  passedAt: string | null;
};

// requiresExam=false인 강좌는 null을 반환한다(호출부에서 섹션 자체를 숨김).
export async function getCourseExamState(userId: string, courseId: string): Promise<CourseExamState | null> {
  const course = await getCourseForClassroom(courseId);
  if (!course || !course.requiresExam) return null;

  const supabase = await createClient();
  const [lessons, statsByCourse, latestAssignments, questionsRes, submissionsRes, resetAtRes] = await Promise.all([
    getLessonsForClassroom(courseId),
    getProgressStatsForCourses(userId, [courseId]),
    getLatestAssignmentSubmissionsForCourse(userId, courseId),
    // course_exam_question_links/exam_question_bank/exam_bank_options는 admin-only select
    // RLS라 학습자 세션으로 직접 select할 수 없다 — 문항 개수/정답 미설정 여부만 담은
    // get_course_exam_readiness() RPC로 우회한다(get_my_exam_reset_at()과 동일한 이유,
    // qa-reviewer 지적, 2026-09-10).
    supabase.rpc('get_course_exam_readiness', { p_course_id: courseId }),
    supabase
      .from('course_exam_submissions')
      .select('score, passed, submitted_at')
      .eq('user_id', userId)
      .eq('course_id', courseId)
      .order('submitted_at', { ascending: false }),
    // course_exam_attempt_resets는 관리자 전용 select 정책이라 본인 세션으로는 조회할 수
    // 없다 — get_my_exam_reset_at() RPC로 reset_at 하나만 SECURITY DEFINER로 받아온다
    // (qa-reviewer/privacy-security-officer 공통 지적, 2026-09-09: 관리자가 리셋해도
    // 학습자 화면이 계속 'exhausted'로 남아있던 버그).
    supabase.rpc('get_my_exam_reset_at', { p_course_id: courseId }),
  ]);
  if (questionsRes.error) throw new Error(questionsRes.error.message);
  if (submissionsRes.error) throw new Error(submissionsRes.error.message);
  if (resetAtRes.error) throw new Error(resetAtRes.error.message);

  const stats = statsByCourse[courseId];
  const pendingAssignmentLessonTitles = lessons
    .filter((l) => l.hasAssignment && latestAssignments.get(l.id)?.status !== 'approved')
    .map((l) => l.title);
  const progressComplete = stats.totalLessons > 0 && stats.completedLessons === stats.totalLessons && pendingAssignmentLessonTitles.length === 0;

  const readiness = (questionsRes.data as { question_count: number; has_unresolved_question: boolean }[] | null)?.[0] ?? {
    question_count: 0,
    has_unresolved_question: false,
  };
  const questionCount = readiness.question_count;
  // 정답이 하나도 지정되지 않은 문항이 있으면 submit_course_exam() RPC가 'exam not ready'로
  // 응시 자체를 거부한다 — 화면 상태도 동일 기준으로 미리 'not_ready'를 보여준다(qa-reviewer 지적).
  const hasUnresolvedQuestion = readiness.has_unresolved_question;
  const submissions = (submissionsRes.data as { score: number; passed: boolean; submitted_at: string }[]) ?? [];
  const lastResetAtMs = resetAtRes.data ? new Date(resetAtRes.data as string).getTime() : null;
  const submissionsSinceReset = lastResetAtMs === null ? submissions : submissions.filter((s) => new Date(s.submitted_at).getTime() > lastResetAtMs);

  const passedSubmission = submissions.find((s) => s.passed) ?? null;
  const latestSubmission = submissions[0] ?? null;

  let status: CourseExamStatus;
  if (!progressComplete) {
    status = 'locked';
  } else if (questionCount === 0 || hasUnresolvedQuestion) {
    status = 'not_ready';
  } else if (passedSubmission) {
    status = 'passed';
  } else if (course.examMaxAttempts !== null && submissionsSinceReset.length >= course.examMaxAttempts) {
    status = 'exhausted';
  } else {
    status = 'available';
  }

  return {
    status,
    completedLessons: stats.completedLessons,
    totalLessons: stats.totalLessons,
    pendingAssignmentLessonTitles,
    examPassScore: course.examPassScore,
    examMaxAttempts: course.examMaxAttempts,
    remainingAttempts: status === 'available' && course.examMaxAttempts !== null ? course.examMaxAttempts - submissionsSinceReset.length : null,
    lastScore: latestSubmission?.score ?? null,
    passedScore: passedSubmission?.score ?? null,
    passedAt: passedSubmission?.submitted_at ?? null,
  };
}

// get_course_exam() RPC 래핑 — 정답은 응답에 포함되지 않는다(get_quiz_for_lesson과 동일 원칙).
export async function getCourseExamQuestions(courseId: string): Promise<CourseExamQuestionWithOptions[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_course_exam', { p_course_id: courseId });
  if (error) throw new Error(error.message);

  const rows = data as {
    question_id: string;
    question: string;
    question_order: number;
    option_id: string;
    option_label: string;
    option_order: number;
  }[];

  const questions = new Map<string, CourseExamQuestionWithOptions>();
  for (const row of rows) {
    if (!questions.has(row.question_id)) {
      questions.set(row.question_id, { id: row.question_id, question: row.question, order: row.question_order, options: [] });
    }
    questions.get(row.question_id)!.options.push({ id: row.option_id, label: row.option_label, order: row.option_order });
  }

  return [...questions.values()].sort((a, b) => a.order - b.order);
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
