// Admin 콘솔(module-lms-6) 전용 조회 함수 모음.
// lib/supabase/queries.ts와 동일한 컨벤션(createClient() → select → snake_case→camelCase
// 매핑 → error 시 throw)을 따르되, 학습자 화면과 무관한 관리자 전용 조회가 많아 파일을 분리했다.
// RLS(is_admin())가 서버에서 이미 강제하므로 여기서 role을 다시 확인하지 않는다 — 이 함수들은
// admin 라우트(app/(admin)/*, proxy.ts가 role='admin'만 통과시킴)에서만 호출된다는 전제.

import { headers } from 'next/headers';
import { getKstStartOfDaysAgoIso, getKstStartOfTodayIso, getKstStartOfWeekIso, formatKstWeekRangeLabel, toKstDateKey } from '@/lib/kst';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminClient } from '@/lib/supabase/require-admin';
import { createClient } from '@/lib/supabase/server';
import {
  deriveStatus,
  collectDescendantIds,
  getApprovedSeatsTaken,
  getMyEnrollments,
  mapCourseMaterialRow,
  mapCourseRow,
  COURSE_COLUMNS,
  type CourseMaterialRow,
  type CourseRow,
} from '@/lib/supabase/queries';
import type {
  AssignmentSubmissionStatus,
  Course,
  CourseMaterial,
  CourseStatus,
  EnrollmentStatus,
  Lesson,
  LegalDocType,
  Profile,
  ProfileStatus,
  UserRole,
} from '@/lib/types';

// ===================== 공통 매핑 헬퍼 =====================
// courses 관련 타입/매핑(CourseRow/mapCourseRow/COURSE_COLUMNS)은 lib/supabase/queries.ts가
// canonical source다 — courses 필드 추가 시 세 파일(queries/admin-queries/classroom-queries)을
// 매번 손으로 맞추던 반복 지적된 기술부채를 여기서 해소한다(2026-09-10). lessons/
// course_materials는 admin 전용 조인이 필요해(getAdminCourseById) 이 파일에 그대로 둔다.

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
    assignmentDueAt: row.assignment_due_at,
    hasQuiz: row.has_quiz,
    hasAssignment: row.has_assignment,
    lessonMode: row.lesson_mode,
    onlineMeetingUrl: row.online_meeting_url,
    onlineScheduledAt: row.online_scheduled_at,
    offlineLocationName: row.offline_location_name,
    offlineAddress: row.offline_address,
  };
}

// ===================== 대시보드 (/admin) =====================

export type AdminDashboardStats = {
  newApplicationsToday: number; // 오늘 생성된 신청 전체 (처리 상태 무관)
  paymentPendingTotal: number; // status='pending' 전체 누적
  approvedToday: number; // status='approved' and 오늘 승인
};

export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  const supabase = await createClient();
  const todayStartIso = getKstStartOfTodayIso();

  // newApplicationsToday는 원래 status='pending'까지 걸러서 "오늘 들어왔고 아직 처리
  // 안 된 건"이 됐었다 — 관리자가 부지런히 처리할수록 숫자가 줄어드는 역설이 있어
  // status 조건을 빼고 "오늘 들어온 신청 전체"로 바꿨다(qa-reviewer 점검, 2026-08-08).
  const [newToday, pendingTotal, approvedToday] = await Promise.all([
    supabase.from('enrollments').select('id', { count: 'exact', head: true }).gte('created_at', todayStartIso),
    supabase.from('enrollments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('enrollments').select('id', { count: 'exact', head: true }).eq('status', 'approved').gte('approved_at', todayStartIso),
  ]);

  const firstError = newToday.error ?? pendingTotal.error ?? approvedToday.error;
  if (firstError) throw new Error(firstError.message);

  return {
    newApplicationsToday: newToday.count ?? 0,
    paymentPendingTotal: pendingTotal.count ?? 0,
    approvedToday: approvedToday.count ?? 0,
  };
}

// ===================== 대시보드 — 회원 가입 (F-ADM-2~5, 2026-09-09) =====================
// F-ADM-2~5 공통 전제(menu-features.md 참고): 여기서 "가입"은 email 인증 여부와 무관하게
// auth.users insert 시점에 profiles가 함께 생성되는 "가입 시도" 기준이다(실사용 회원이 아님).
// role='admin' 계정은 전부 제외, status='withdrawn'(탈퇴) 회원은 가입 사실 자체는 유지하기
// 위해 집계(카드/차트)에는 포함하되 개인식별 목록(최근 가입자)에서는 제외한다(익명화된 이름만
// 남아 노출해도 의미가 없음).

// auth.users.email_confirmed_at은 일반 RLS 클라이언트로 조회할 수 없어 service_role 기반
// admin.auth.admin.listUsers()로만 가져올 수 있다. 대시보드 로드마다 전체 회원을 순회하는
// 비용을 줄이기 위해 60초 메모리 캐시를 둔다(product-manager 결정) — Amplify SSR의 웜
// 컨테이너 수명 동안만 유효한 프로세스 내 캐시이며, 콜드스타트 시 자연히 초기화된다.
let authConfirmationCache: { map: Map<string, string | null>; expiresAt: number } | null = null;

// 캐시 채움 직후 60초 이내 가입한 회원은 이 맵에 없어 "미인증"으로 잘못 표시될 수 있다
// (60초 뒤 캐시가 갱신되면 자연히 해소되는 트레이드오프, qa-reviewer 지적, 2026-09-09).
async function getAuthConfirmationMap(): Promise<Map<string, string | null>> {
  // service_role로 RLS를 완전히 우회하는 이 프로젝트의 유일한 조회 경로다. 지금은 이
  // 함수를 호출하는 곳이 admin 대시보드뿐이라 당장 뚫리진 않지만, RLS 하나에만 기대지
  // 않고 require-admin.ts와 동일하게 앱 레벨에서도 재확인한다 — 나중에 이 함수가 다른
  // 화면에서 재사용되는 순간 전 회원 인증상태가 즉시 노출되는 구조이기 때문
  // (privacy-security-officer 점검, 2026-09-09).
  await requireAdminClient();

  const now = Date.now();
  if (authConfirmationCache && authConfirmationCache.expiresAt > now) {
    return authConfirmationCache.map;
  }

  const admin = createAdminClient();
  const map = new Map<string, string | null>();
  const perPage = 1000;
  let page = 1;
  // GoTrue 응답의 nextPage(다음 페이지 없으면 null)로 종료 판단 — data.users.length<perPage
  // 방식은 회원 수가 perPage의 정확한 배수일 때 불필요한 페이지를 한 번 더 요청한다
  // (qa-reviewer 지적, 2026-09-09). page 상한은 응답 스펙이 예상과 다를 때의 안전장치.
  while (page <= 200) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    for (const u of data.users) {
      map.set(u.id, u.email_confirmed_at ?? null);
    }
    if (!data.nextPage) break;
    page = data.nextPage;
  }

  authConfirmationCache = { map, expiresAt: now + 60_000 };
  return map;
}

// 이메일 로컬파트 앞 2자만 노출("ab***@gmail.com"). 대시보드는 관리자가 상시 띄워두는
// 첫 화면이라 회원관리 목록(전체 노출)보다 어깨너머 노출 위험이 커 마스킹한다.
// 로컬파트가 2자 이하면 slice(0,2)가 전체를 그대로 반환해 마스킹이 무의미해지는
// 버그가 있었다 — 이 경우 통째로 가린다(privacy-security-officer 지적, 2026-09-09).
function maskEmail(email: string | null | undefined): string {
  if (!email) return '-';
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return '***';
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (local.length <= 2) return `***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

export type SignupSummary = {
  todayCount: number;
  weekCount: number;
  weekRangeLabel: string; // 이번 주 월요일(KST)부터 오늘까지 — 롤링 7일이 아니라 "주간 실적" 개념이라
  // 주 중간(예: 수요일)에 보면 "9/8~9/9"처럼 아직 끝나지 않은 기간으로 표시된다(주 전체 범위 아님).
};

export async function getSignupSummary(): Promise<SignupSummary> {
  const supabase = await createClient();
  const todayStartIso = getKstStartOfTodayIso();
  const weekStartIso = getKstStartOfWeekIso();

  const [todayRes, weekRes] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'learner').gte('created_at', todayStartIso),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'learner').gte('created_at', weekStartIso),
  ]);

  const firstError = todayRes.error ?? weekRes.error;
  if (firstError) throw new Error(firstError.message);

  return {
    todayCount: todayRes.count ?? 0,
    weekCount: weekRes.count ?? 0,
    weekRangeLabel: formatKstWeekRangeLabel(weekStartIso),
  };
}

export type RecentSignup = {
  id: string;
  name: string;
  maskedEmail: string;
  createdAt: string;
  // null = auth.users에서 이 회원을 찾지 못한 경우("확인 불가") — listUsers 페이지네이션이
  // 예상과 다르게 잘렸을 때 인증완료 회원을 "미인증"으로 잘못 표시하지 않기 위해 구분한다
  // (privacy-security-officer 지적, 2026-09-09).
  confirmed: boolean | null;
};

export async function getRecentSignups(limit = 10): Promise<RecentSignup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, created_at')
    .eq('role', 'learner')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const confirmationMap = await getAuthConfirmationMap();

  return (data as { id: string; name: string; email: string | null; created_at: string }[]).map((row) => {
    const confirmedAt = confirmationMap.get(row.id);
    return {
      id: row.id,
      name: row.name,
      maskedEmail: maskEmail(row.email),
      createdAt: row.created_at,
      confirmed: confirmedAt === undefined ? null : confirmedAt !== null,
    };
  });
}

export type SignupTrendPoint = { date: string; count: number }; // date: "YYYY-MM-DD"(KST)

export async function getSignupTrend(days = 30): Promise<SignupTrendPoint[]> {
  const supabase = await createClient();
  const startIso = getKstStartOfDaysAgoIso(days - 1);

  const { data, error } = await supabase.from('profiles').select('created_at').eq('role', 'learner').gte('created_at', startIso);
  if (error) throw new Error(error.message);

  const counts = new Map<string, number>();
  for (const row of data as { created_at: string }[]) {
    const key = toKstDateKey(row.created_at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const points: SignupTrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = toKstDateKey(getKstStartOfDaysAgoIso(i));
    points.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return points;
}

// role='learner' 전체를 select하는데 limit이 없으면 Supabase 기본 max-rows(1000)를 넘는
// 순간부터 조용히 잘려 집계가 틀어진다 — range()로 직접 페이지네이션한다
// (privacy-security-officer 지적, 2026-09-09). listUsers 루프와 동일하게 상한을 둔다.
async function getAllActiveLearnerSignupDates(): Promise<{ id: string; created_at: string }[]> {
  const supabase = await createClient();
  const pageSize = 1000;
  const rows: { id: string; created_at: string }[] = [];
  let from = 0;
  while (from < 200_000) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, created_at')
      .eq('role', 'learner')
      .eq('status', 'active') // 탈퇴 회원은 재로그인이 불가해 애초에 미인증일 수 없다 — 이메일
      // 익명화 과정에서 auth.users.email_confirmed_at이 초기화되더라도 "미인증/방치"로
      // 잘못 집계되지 않도록 조회 단계에서 제외한다(privacy-security-officer 지적, 2026-09-09).
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = data as { id: string; created_at: string }[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

export type UnconfirmedMemberStats = { total: number; staleOver7Days: number };

export async function getUnconfirmedMemberStats(): Promise<UnconfirmedMemberStats> {
  const [profiles, confirmationMap] = await Promise.all([getAllActiveLearnerSignupDates(), getAuthConfirmationMap()]);
  const staleThresholdMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

  let total = 0;
  let staleOver7Days = 0;
  for (const row of profiles) {
    const confirmedAt = confirmationMap.get(row.id);
    if (confirmedAt === undefined) continue; // auth.users에서 못 찾은 극히 드문 경우 — 집계 제외
    if (confirmedAt !== null) continue; // 인증 완료
    total += 1;
    if (new Date(row.created_at).getTime() < staleThresholdMs) staleOver7Days += 1;
  }

  return { total, staleOver7Days };
}

export type OverCapacityCourse = { courseId: string; title: string; seats: number; approvedCount: number };

// flows.md 3.5 "승인 후 정원 초과 발견 → 승인은 막지 않되 대시보드에 경고 표시"에 대응.
export async function getOverCapacityCourses(): Promise<OverCapacityCourse[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('courses').select('id, title, seats');
  if (error) throw new Error(error.message);

  const courses = data as { id: string; title: string; seats: number }[];
  const approvedCounts = await getApprovedSeatsTaken(courses.map((c) => c.id));

  return courses
    .map((c) => ({ courseId: c.id, title: c.title, seats: c.seats, approvedCount: approvedCounts[c.id] ?? 0 }))
    .filter((c) => c.approvedCount > c.seats);
}

type ApprovedEnrollmentProgressStat = {
  userId: string;
  userName: string;
  courseId: string;
  courseTitle: string;
  totalLessons: number;
  completedLessons: number;
  assignmentLessonIds: string[];
  approvedAssignmentLessonIds: Set<string>;
  hasCertificate: boolean;
  requiresExam: boolean;
  examQuestionCount: number;
  examMaxAttempts: number | null;
  examPassed: boolean;
  examAttemptsSinceReset: number;
  examLastScore: number | null;
};

// 승인된 신청 건별로 진도/과제/시험 승인 현황을 계산한다. 대시보드 "수료임박"과 Admin
// 수료관리 "수료 조건 충족자"/"수료 보류 학습자" 목록이 동일한 원자료를 서로 다른 기준으로
// 거르므로 여기서 한 번만 조회한다(2026-09-09: 자격시험 데이터 추가).
async function getApprovedEnrollmentProgressStats(): Promise<ApprovedEnrollmentProgressStat[]> {
  const supabase = await createClient();

  const { data: enrollmentRows, error: enrollmentError } = await supabase
    .from('enrollments')
    .select(
      'user_id, course_id, profiles(name), courses(title, requires_exam, exam_max_attempts, lessons(id, has_assignment), course_exam_question_links(id))'
    )
    .eq('status', 'approved');
  if (enrollmentError) throw new Error(enrollmentError.message);

  const rows = enrollmentRows as unknown as {
    user_id: string;
    course_id: string;
    profiles: { name: string };
    courses: {
      title: string;
      requires_exam: boolean;
      exam_max_attempts: number | null;
      lessons: { id: string; has_assignment: boolean }[];
      course_exam_question_links: { id: string }[];
    };
  }[];
  const candidates = rows.filter((r) => r.courses.lessons.length > 0);
  if (candidates.length === 0) return [];

  const userIds = [...new Set(candidates.map((r) => r.user_id))];

  const [certRes, progressRes, assignmentRes, examSubmissionRes, examResetRes] = await Promise.all([
    supabase.from('certificates').select('user_id, course_id'),
    supabase.from('progress').select('user_id, lesson_id').in('user_id', userIds).not('completed_at', 'is', null),
    supabase.from('assignment_submissions').select('user_id, lesson_id').in('user_id', userIds).eq('status', 'approved'),
    supabase.from('course_exam_submissions').select('user_id, course_id, score, passed, submitted_at').in('user_id', userIds),
    supabase.from('course_exam_attempt_resets').select('user_id, course_id, reset_at').in('user_id', userIds),
  ]);
  if (certRes.error) throw new Error(certRes.error.message);
  if (progressRes.error) throw new Error(progressRes.error.message);
  if (assignmentRes.error) throw new Error(assignmentRes.error.message);
  if (examSubmissionRes.error) throw new Error(examSubmissionRes.error.message);
  if (examResetRes.error) throw new Error(examResetRes.error.message);

  const certifiedSet = new Set(
    (certRes.data as { user_id: string; course_id: string }[]).map((c) => `${c.user_id}:${c.course_id}`)
  );

  const completedLessonsByUser = new Map<string, Set<string>>();
  for (const p of progressRes.data as { user_id: string; lesson_id: string }[]) {
    if (!completedLessonsByUser.has(p.user_id)) completedLessonsByUser.set(p.user_id, new Set());
    completedLessonsByUser.get(p.user_id)!.add(p.lesson_id);
  }

  const approvedAssignmentsByUser = new Map<string, Set<string>>();
  for (const a of assignmentRes.data as { user_id: string; lesson_id: string }[]) {
    if (!approvedAssignmentsByUser.has(a.user_id)) approvedAssignmentsByUser.set(a.user_id, new Set());
    approvedAssignmentsByUser.get(a.user_id)!.add(a.lesson_id);
  }

  const lastResetAtByPair = new Map<string, number>();
  for (const r of examResetRes.data as { user_id: string; course_id: string; reset_at: string }[]) {
    const key = `${r.user_id}:${r.course_id}`;
    const ms = new Date(r.reset_at).getTime();
    if (!lastResetAtByPair.has(key) || ms > lastResetAtByPair.get(key)!) lastResetAtByPair.set(key, ms);
  }

  const examSubmissionsByPair = new Map<string, { score: number; passed: boolean; submitted_at: string }[]>();
  for (const s of examSubmissionRes.data as { user_id: string; course_id: string; score: number; passed: boolean; submitted_at: string }[]) {
    const key = `${s.user_id}:${s.course_id}`;
    if (!examSubmissionsByPair.has(key)) examSubmissionsByPair.set(key, []);
    examSubmissionsByPair.get(key)!.push(s);
  }

  return candidates.map((r) => {
    const completedSet = completedLessonsByUser.get(r.user_id) ?? new Set<string>();
    const approvedSet = approvedAssignmentsByUser.get(r.user_id) ?? new Set<string>();
    const pairKey = `${r.user_id}:${r.course_id}`;
    const submissions = (examSubmissionsByPair.get(pairKey) ?? []).slice().sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1));
    const lastResetAtMs = lastResetAtByPair.get(pairKey) ?? null;
    const submissionsSinceReset =
      lastResetAtMs === null ? submissions : submissions.filter((s) => new Date(s.submitted_at).getTime() > lastResetAtMs);

    return {
      userId: r.user_id,
      userName: r.profiles.name,
      courseId: r.course_id,
      courseTitle: r.courses.title,
      totalLessons: r.courses.lessons.length,
      completedLessons: r.courses.lessons.filter((l) => completedSet.has(l.id)).length,
      assignmentLessonIds: r.courses.lessons.filter((l) => l.has_assignment).map((l) => l.id),
      approvedAssignmentLessonIds: approvedSet,
      hasCertificate: certifiedSet.has(pairKey),
      requiresExam: r.courses.requires_exam,
      examQuestionCount: r.courses.course_exam_question_links.length,
      examMaxAttempts: r.courses.exam_max_attempts,
      examPassed: submissions.some((s) => s.passed),
      examAttemptsSinceReset: submissionsSinceReset.length,
      examLastScore: submissions[0]?.score ?? null,
    };
  });
}

export type NearCompletionLearner = {
  userId: string;
  userName: string;
  courseId: string;
  courseTitle: string;
  completedLessons: number;
  totalLessons: number;
  ratio: number;
};

// "수료임박" 정의(문서에 임계값 없어 임의 채택, 2026-08-06): 진도 80%~99% & 미발급.
export async function getNearCompletionLearners(): Promise<NearCompletionLearner[]> {
  const stats = await getApprovedEnrollmentProgressStats();
  return stats
    .filter((s) => !s.hasCertificate)
    .map((s) => ({ ...s, ratio: s.completedLessons / s.totalLessons }))
    .filter((s) => s.ratio >= 0.8 && s.ratio < 1)
    .map((s) => ({
      userId: s.userId,
      userName: s.userName,
      courseId: s.courseId,
      courseTitle: s.courseTitle,
      completedLessons: s.completedLessons,
      totalLessons: s.totalLessons,
      ratio: s.ratio,
    }));
}

// ===================== 수료 관리 (/admin/certificates) =====================

export type CertificateEligibleLearner = { userId: string; userName: string; courseId: string; courseTitle: string };

// 수료 조건(flows.md Q7 + F-LRN-9): 진도 100% + (과제가 있는 강의는 전부) 과제 승인 +
// (자격시험이 있는 강좌는) 시험 합격, 미발급.
export async function getCertificateEligibleLearners(): Promise<CertificateEligibleLearner[]> {
  const stats = await getApprovedEnrollmentProgressStats();
  return stats
    .filter((s) => !s.hasCertificate && s.completedLessons === s.totalLessons)
    .filter((s) => s.assignmentLessonIds.every((id) => s.approvedAssignmentLessonIds.has(id)))
    .filter((s) => !s.requiresExam || s.examPassed)
    .map((s) => ({ userId: s.userId, userName: s.userName, courseId: s.courseId, courseTitle: s.courseTitle }));
}

export type CertificatePendingReason = 'progress' | 'assignment' | 'exam';

export type CertificatePendingLearner = {
  userId: string;
  userName: string;
  courseId: string;
  courseTitle: string;
  completedLessons: number;
  totalLessons: number;
  pendingAssignmentCount: number;
  requiresExam: boolean;
  examState: 'not_applicable' | 'not_attempted' | 'failed' | 'exhausted' | 'passed';
  examAttemptsSinceReset: number;
  examMaxAttempts: number | null;
  reasons: CertificatePendingReason[];
};

// F-ADMCE-1: "이 학습자는 왜 아직 수료증을 못 받았나요?"에 한 화면에서 답하기 위한 목록.
// 미발급 + (진도/과제/시험 중 하나라도 미충족)인 승인된 신청 건 전부를 대상으로 한다.
export async function getCertificatePendingLearners(): Promise<CertificatePendingLearner[]> {
  const stats = await getApprovedEnrollmentProgressStats();

  return stats
    .filter((s) => !s.hasCertificate)
    .map((s) => {
      const progressDone = s.completedLessons === s.totalLessons;
      const pendingAssignmentCount = s.assignmentLessonIds.filter((id) => !s.approvedAssignmentLessonIds.has(id)).length;
      const assignmentDone = pendingAssignmentCount === 0;

      let examState: CertificatePendingLearner['examState'] = 'not_applicable';
      if (s.requiresExam) {
        if (s.examPassed) examState = 'passed';
        else if (s.examMaxAttempts !== null && s.examAttemptsSinceReset >= s.examMaxAttempts) examState = 'exhausted';
        else if (s.examAttemptsSinceReset > 0) examState = 'failed';
        else examState = 'not_attempted';
      }
      const examDone = !s.requiresExam || examState === 'passed';

      const reasons: CertificatePendingReason[] = [];
      if (!progressDone) reasons.push('progress');
      if (!assignmentDone) reasons.push('assignment');
      if (!examDone) reasons.push('exam');

      return {
        userId: s.userId,
        userName: s.userName,
        courseId: s.courseId,
        courseTitle: s.courseTitle,
        completedLessons: s.completedLessons,
        totalLessons: s.totalLessons,
        pendingAssignmentCount,
        requiresExam: s.requiresExam,
        examState,
        examAttemptsSinceReset: s.examAttemptsSinceReset,
        examMaxAttempts: s.examMaxAttempts,
        reasons,
      };
    })
    .filter((s) => s.reasons.length > 0);
}

export type AdminCourseExamSubmission = {
  userId: string;
  userName: string;
  courseId: string;
  courseTitle: string;
  score: number;
  passed: boolean;
  attemptNo: number;
  submittedAt: string;
};

// F-ADMCE-5: requiresExam=true인 강좌의 전체 응시 이력. /admin/certificates와
// /admin/members/[id](F-ADMM-2) 양쪽에서 재사용하는 공용 조회 함수.
export async function getCourseExamSubmissionHistory(filters?: { courseId?: string; userId?: string }): Promise<AdminCourseExamSubmission[]> {
  const supabase = await createClient();
  let query = supabase
    .from('course_exam_submissions')
    .select('user_id, course_id, score, passed, attempt_no, submitted_at, profiles(name), courses(title)')
    .order('submitted_at', { ascending: false });

  if (filters?.courseId) query = query.eq('course_id', filters.courseId);
  if (filters?.userId) query = query.eq('user_id', filters.userId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (
    data as unknown as {
      user_id: string;
      course_id: string;
      score: number;
      passed: boolean;
      attempt_no: number;
      submitted_at: string;
      profiles: { name: string };
      courses: { title: string };
    }[]
  ).map((row) => ({
    userId: row.user_id,
    userName: row.profiles.name,
    courseId: row.course_id,
    courseTitle: row.courses.title,
    score: row.score,
    passed: row.passed,
    attemptNo: row.attempt_no,
    submittedAt: row.submitted_at,
  }));
}

export type AdminCertificateListItem = {
  id: string;
  userId: string;
  userName: string;
  courseId: string;
  courseTitle: string;
  issuedAt: string;
  isManualOverride: boolean;
  note: string | null;
};

export async function getIssuedCertificates(): Promise<AdminCertificateListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('certificates')
    .select('id, user_id, course_id, issued_at, is_manual_override, note, profiles(name), courses(title)')
    .order('issued_at', { ascending: false });
  if (error) throw new Error(error.message);

  return (
    data as unknown as {
      id: string;
      user_id: string;
      course_id: string;
      issued_at: string;
      is_manual_override: boolean;
      note: string | null;
      profiles: { name: string };
      courses: { title: string };
    }[]
  ).map((c) => ({
    id: c.id,
    userId: c.user_id,
    userName: c.profiles.name,
    courseId: c.course_id,
    courseTitle: c.courses.title,
    issuedAt: c.issued_at,
    isManualOverride: c.is_manual_override,
    note: c.note,
  }));
}

// ===================== 강좌 관리 (/admin/courses) =====================

export type AdminCourseListItem = {
  id: string;
  slug: string;
  title: string;
  categoryName: string | null;
  fee: number;
  seats: number;
  status: CourseStatus;
  approvedCount: number;
  enrollmentCount: number; // 상태 무관 전체 — 삭제 가드(F-ADMC-3)
  certificateCount: number; // 삭제 가드
  requiresExam: boolean;
  examQuestionCount: number; // requiresExam=true인데 0이면 목록에 경고 배지(F-ADMC-9)
};

export async function getEnrollmentCountsByCourse(courseIds: string[]): Promise<Record<string, number>> {
  if (courseIds.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.from('enrollments').select('course_id').in('course_id', courseIds);
  if (error) throw new Error(error.message);
  return (data as { course_id: string }[]).reduce<Record<string, number>>((acc, row) => {
    acc[row.course_id] = (acc[row.course_id] ?? 0) + 1;
    return acc;
  }, {});
}

export async function getCertificateCountsByCourse(courseIds: string[]): Promise<Record<string, number>> {
  if (courseIds.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.from('certificates').select('course_id').in('course_id', courseIds);
  if (error) throw new Error(error.message);
  return (data as { course_id: string }[]).reduce<Record<string, number>>((acc, row) => {
    acc[row.course_id] = (acc[row.course_id] ?? 0) + 1;
    return acc;
  }, {});
}

export async function getAdminCourses(filters?: {
  status?: CourseStatus | 'all';
  categoryId?: string;
  q?: string;
}): Promise<AdminCourseListItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from('courses')
    .select('id, slug, title, fee, seats, status, requires_exam, categories(name), course_exam_question_links(id)')
    .order('created_at', { ascending: false });

  if (filters?.status && filters.status !== 'all') query = query.eq('status', filters.status);
  if (filters?.categoryId) query = query.eq('category_id', filters.categoryId);
  if (filters?.q) query = query.ilike('title', `%${filters.q}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data as unknown as {
    id: string;
    slug: string;
    title: string;
    fee: number;
    seats: number;
    status: CourseStatus;
    requires_exam: boolean;
    categories: { name: string } | null;
    course_exam_question_links: { id: string }[];
  }[];
  const courseIds = rows.map((c) => c.id);

  const [approvedCounts, enrollmentCounts, certificateCounts] = await Promise.all([
    getApprovedSeatsTaken(courseIds),
    getEnrollmentCountsByCourse(courseIds),
    getCertificateCountsByCourse(courseIds),
  ]);

  return rows.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    categoryName: c.categories?.name ?? null,
    fee: c.fee,
    seats: c.seats,
    status: c.status,
    approvedCount: approvedCounts[c.id] ?? 0,
    enrollmentCount: enrollmentCounts[c.id] ?? 0,
    certificateCount: certificateCounts[c.id] ?? 0,
    requiresExam: c.requires_exam,
    examQuestionCount: c.course_exam_question_links.length,
  }));
}

export type AdminCourseDetail = Course & { lessons: Lesson[]; materials: CourseMaterial[] };

export async function getAdminCourseById(id: string): Promise<AdminCourseDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('courses')
    .select(
      `${COURSE_COLUMNS}, lessons(id, course_id, title, video_url, order, has_quiz, has_assignment, assignment_due_at, lesson_mode, online_meeting_url, online_scheduled_at, offline_location_name, offline_address), course_materials(id, course_id, kind, title, publisher, purchase_url, order)`
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as unknown as CourseRow & { lessons: LessonRow[]; course_materials: CourseMaterialRow[] };
  return {
    ...mapCourseRow(row),
    lessons: row.lessons
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(mapLessonRow),
    materials: row.course_materials
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(mapCourseMaterialRow),
  };
}

// ===================== 카테고리 관리 (/admin/categories) =====================

// 문제은행 관리 화면(/admin/exam-bank)의 카테고리 선택기용. 처음엔 1Depth(자격증) 전체를
// 하나의 문제은행으로 공유했으나, 관리자 피드백으로 "1Depth 전체 공용은 너무 넓다 —
// 같은 자격증이라도 2급/1급처럼 2Depth 세부과정마다 문항이 달라 찾기 어렵다"는 지적을
// 받아 **2Depth 단위**로 좁혔다(2026-09-10). 세부과정을 안 나눈 자격증(1Depth에 직접
// 강좌를 배정)을 위해 1Depth 루트 자체도 옵션으로 함께 보여준다 — `getCourseExamBankCategoryId()`가
// depth 1~2는 그대로, depth 3은 부모(depth 2)로 캡핑하는 것과 동일한 기준.
export type AdminExamBankCategory = { id: string; label: string };

export async function getExamBankCategories(): Promise<AdminExamBankCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, depth, parent_id, is_certification')
    .lte('depth', 2)
    .order('order', { ascending: true });
  if (error) throw new Error(error.message);

  const rows = data as { id: string; name: string; depth: number; parent_id: string | null; is_certification: boolean }[];
  const byId = new Map(rows.map((row) => [row.id, row]));

  const categories: AdminExamBankCategory[] = [];
  for (const row of rows) {
    if (row.depth === 1) {
      if (row.is_certification) categories.push({ id: row.id, label: row.name });
    } else if (row.depth === 2) {
      const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
      if (parent?.is_certification) categories.push({ id: row.id, label: `${parent.name} > ${row.name}` });
    }
  }
  return categories;
}

export async function getCategoryCourseCounts(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('courses').select('category_id');
  if (error) throw new Error(error.message);
  return (data as { category_id: string }[]).reduce<Record<string, number>>((acc, row) => {
    acc[row.category_id] = (acc[row.category_id] ?? 0) + 1;
    return acc;
  }, {});
}

// parent_id는 on delete restrict라 자식이 있으면 삭제가 DB에서부터 막힌다 —
// 삭제 시도 전에 미리 확인해 친절한 안내 문구를 보여주기 위한 사전 조회.
export async function getCategoryChildCount(categoryId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('categories')
    .select('id', { count: 'exact', head: true })
    .eq('parent_id', categoryId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// re-export: 카테고리 관리 페이지에서 "본인+하위가 강좌에 쓰이는지" 판정에 사용
export { collectDescendantIds };

// ===================== 회원 관리 (/admin/members) =====================

export type AdminMemberListItem = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: ProfileStatus;
  createdAt: string;
};

export async function getAdminMembers(params?: {
  q?: string;
  status?: ProfileStatus | 'all';
  role?: UserRole | 'all';
}): Promise<AdminMemberListItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from('profiles')
    .select('id, name, email, phone, role, status, created_at')
    .order('created_at', { ascending: false });

  if (params?.status && params.status !== 'all') query = query.eq('status', params.status);
  // 회원 관리(/admin/members)는 role='learner'만, 운영자 관리(/admin/operators)는
  // role='admin'만 보도록 분리한다 — 이전에는 이 필터가 없어 두 목록이 한 화면에
  // 섞여 있었다(관리자 요청, 2026-08-25).
  if (params?.role && params.role !== 'all') query = query.eq('role', params.role);
  if (params?.q) {
    // PostgREST의 or= 필터 문법은 ','와 '()'가 구조적 의미를 가진다 — 검색어에 그대로
    // 두면 의도하지 않은 조건이 주입될 수 있어 제거한다(security-officer 점검, 2026-08-08).
    const sanitizedQ = params.q.replace(/[,()]/g, '').trim();
    if (sanitizedQ) query = query.or(`name.ilike.%${sanitizedQ}%,email.ilike.%${sanitizedQ}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (
    data as { id: string; name: string; email: string | null; phone: string | null; role: UserRole; status: ProfileStatus; created_at: string }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    role: r.role,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export type AdminMemberDetail = {
  profile: Profile;
  // 사진은 private 버킷 경로만 저장되어 있어 직접 노출할 수 없다 — 매 조회마다 짧은
  // 만료시간(60초)의 서명 URL을 새로 발급한다(2026-08-28, 자격증 발급용 사진 열람).
  photoSignedUrl: string | null;
  enrollments: Awaited<ReturnType<typeof getMyEnrollments>>;
  certificates: { id: string; courseId: string; courseTitle: string; issuedAt: string; isManualOverride: boolean; note: string | null }[];
};

// 제8조 5항(개인정보처리시스템 접속기록) 대응. 위변조 방지를 위해 RLS에 update/delete 정책이
// 없고, 유일한 삭제 경로는 1년 경과분만 지우는 purge_old_admin_access_logs() RPC(pg_cron)뿐이다.
// 로그 기록 실패가 실제 조회 자체를 막으면 안 되므로(가용성 우선) 에러는 삼키고 무시한다.
async function logAdminAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  targetUserId: string,
  action: string,
  detail?: string
) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;

    await supabase.from('admin_access_logs').insert({
      admin_id: user.id,
      target_user_id: targetUserId,
      action,
      detail: detail ?? null,
      ip_address: ip,
    });
  } catch {
    // 접속기록은 감사 목적 부가 기능이라 실패해도 본 조회 흐름을 막지 않는다.
  }
}

export async function getAdminMemberDetail(userId: string): Promise<AdminMemberDetail | null> {
  const supabase = await createClient();
  const { data: profileRow, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, phone, email, role, status, withdrawn_at, address, photo_path')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profileRow) return null;

  await logAdminAccess(supabase, userId, '조회', '회원 상세(주소/사진/신청내역/수료이력)');

  const [enrollments, certRows, signedUrlRes] = await Promise.all([
    getMyEnrollments(userId),
    supabase.from('certificates').select('id, course_id, issued_at, is_manual_override, note, courses(title)').eq('user_id', userId),
    profileRow.photo_path
      ? supabase.storage.from('member-photos').createSignedUrl(profileRow.photo_path, 60)
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (certRows.error) throw new Error(certRows.error.message);

  return {
    profile: {
      id: profileRow.id,
      name: profileRow.name,
      phone: profileRow.phone ?? undefined,
      email: profileRow.email,
      role: profileRow.role,
      status: profileRow.status,
      withdrawnAt: profileRow.withdrawn_at,
      address: profileRow.address,
      photoPath: profileRow.photo_path,
    },
    photoSignedUrl: signedUrlRes.data?.signedUrl ?? null,
    enrollments,
    certificates: (
      certRows.data as unknown as {
        id: string;
        course_id: string;
        issued_at: string;
        is_manual_override: boolean;
        note: string | null;
        courses: { title: string };
      }[]
    ).map((c) => ({
      id: c.id,
      courseId: c.course_id,
      courseTitle: c.courses.title,
      issuedAt: c.issued_at,
      isManualOverride: c.is_manual_override,
      note: c.note,
    })),
  };
}

// ===================== 신청·입금 관리 (/admin/enrollments) =====================

export type AdminEnrollmentListItem = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  courseId: string;
  courseTitle: string;
  fee: number;
  status: EnrollmentStatus;
  paymentDueAt: string;
  createdAt: string;
  rejectionReason: string | null;
};

export async function getAdminEnrollments(filters?: { status?: EnrollmentStatus | 'all' }): Promise<AdminEnrollmentListItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from('enrollments')
    .select('id, user_id, course_id, status, payment_due_at, created_at, rejection_reason, profiles(name, email), courses(title, fee)')
    .order('created_at', { ascending: false });

  if (filters?.status && filters.status !== 'all') query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (
    data as unknown as {
      id: string;
      user_id: string;
      course_id: string;
      status: EnrollmentStatus;
      payment_due_at: string;
      created_at: string;
      rejection_reason: string | null;
      profiles: { name: string; email: string | null };
      courses: { title: string; fee: number };
    }[]
  ).map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.profiles.name,
    userEmail: row.profiles.email,
    courseId: row.course_id,
    courseTitle: row.courses.title,
    fee: row.courses.fee,
    status: deriveStatus(row.status, row.payment_due_at),
    paymentDueAt: row.payment_due_at,
    createdAt: row.created_at,
    rejectionReason: row.rejection_reason,
  }));
}

// ===================== 약관·정책 CMS (/admin/cms) =====================

export type AdminLegalDocumentGroup = {
  slug: string;
  type: LegalDocType;
  title: string;
  latestVersion: number;
  publishedVersion: number | null;
  versions: { id: string; version: number; isPublished: boolean; createdAt: string }[];
};

export async function getAdminLegalDocumentGroups(): Promise<AdminLegalDocumentGroup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('legal_documents')
    .select('id, type, slug, title, version, is_published, created_at')
    .order('slug', { ascending: true })
    .order('version', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = data as { id: string; type: LegalDocType; slug: string; title: string; version: number; is_published: boolean; created_at: string }[];
  const groups = new Map<string, AdminLegalDocumentGroup>();

  for (const row of rows) {
    // slug asc, version desc로 정렬돼 있어 각 slug의 첫 행이 항상 최신 버전이다.
    if (!groups.has(row.slug)) {
      groups.set(row.slug, {
        slug: row.slug,
        type: row.type,
        title: row.title,
        latestVersion: row.version,
        publishedVersion: null,
        versions: [],
      });
    }
    const group = groups.get(row.slug)!;
    group.versions.push({ id: row.id, version: row.version, isPublished: row.is_published, createdAt: row.created_at });
    if (row.is_published) group.publishedVersion = row.version;
  }

  return Array.from(groups.values());
}

export type AdminLegalDocumentRow = {
  id: string;
  type: LegalDocType;
  slug: string;
  title: string;
  content: string;
  version: number;
  isPublished: boolean;
  createdAt: string;
};

export async function getLegalDocumentById(id: string): Promise<AdminLegalDocumentRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('legal_documents')
    .select('id, type, slug, title, content, version, is_published, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    id: data.id,
    type: data.type,
    slug: data.slug,
    title: data.title,
    content: data.content,
    version: data.version,
    isPublished: data.is_published,
    createdAt: data.created_at,
  };
}

// ===================== 퀴즈 저작 (/admin/courses/[id]/lessons/[lessonId]/quiz) =====================
// isCorrect를 포함하는 관리자 전용 타입 — lib/types.ts의 학습자용 QuizQuestionWithOptions에는
// 정답 유출 방지를 위해 이 필드가 없다.

export type AdminQuizOption = { id: string; label: string; order: number; isCorrect: boolean };
export type AdminQuizQuestion = { id: string; lessonId: string; question: string; order: number; options: AdminQuizOption[] };

export async function getQuizQuestionsForLesson(lessonId: string): Promise<AdminQuizQuestion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('quiz_questions')
    .select('id, lesson_id, question, order, quiz_options(id, label, is_correct, order)')
    .eq('lesson_id', lessonId)
    .order('order', { ascending: true });
  if (error) throw new Error(error.message);

  return (
    data as unknown as {
      id: string;
      lesson_id: string;
      question: string;
      order: number;
      quiz_options: { id: string; label: string; is_correct: boolean; order: number }[];
    }[]
  ).map((row) => ({
    id: row.id,
    lessonId: row.lesson_id,
    question: row.question,
    order: row.order,
    options: row.quiz_options
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((o) => ({ id: o.id, label: o.label, order: o.order, isCorrect: o.is_correct })),
  }));
}

// ===================== 자격시험 문제은행 + 강좌 연결 (2026-09-10 재설계) =====================
// 처음엔 문항을 강좌별로 독립 저장했으나, 관리자 요청으로 "같은 자격증 안의 강좌끼리는
// 문제를 공유해서 쓸 수 있어야 한다"는 요구가 추가돼 문제은행 구조로 바뀌었다. 스코프는
// 처음엔 1Depth(자격증) 전체였다가, "1Depth 전체 공용은 너무 넓어 문항 찾기가 어렵다"는
// 관리자 피드백으로 같은 날 다시 2Depth(세부과정, 예: "2급"/"1급") 단위로 좁혔다 —
// getExamBankCategories()/getCourseExamBankCategoryId() 참고.
// isCorrect를 포함하는 관리자 전용 타입 — quiz와 동일한 정답 비노출 패턴.

export type AdminExamBankOption = { id: string; label: string; order: number; isCorrect: boolean };
export type AdminExamBankQuestion = { id: string; categoryId: string; question: string; order: number; options: AdminExamBankOption[] };

export async function getExamBankQuestionsForCategory(categoryId: string): Promise<AdminExamBankQuestion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('exam_question_bank')
    .select('id, category_id, question, order, exam_bank_options(id, label, is_correct, order)')
    .eq('category_id', categoryId)
    .order('order', { ascending: true });
  if (error) throw new Error(error.message);

  return (
    data as unknown as {
      id: string;
      category_id: string;
      question: string;
      order: number;
      exam_bank_options: { id: string; label: string; is_correct: boolean; order: number }[];
    }[]
  ).map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    question: row.question,
    order: row.order,
    options: row.exam_bank_options
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((o) => ({ id: o.id, label: o.label, order: o.order, isCorrect: o.is_correct })),
  }));
}

// 강좌가 속한 "문제은행 스코프" categoryId를 계산한다 — depth 1~2는 그대로, depth 3은
// 부모(depth 2)로 캡핑한다(2026-09-10, 관리자 피드백으로 1Depth 전체 공용에서 2Depth
// 단위로 좁힘 — getExamBankCategories() 주석 참고). "이 강좌가 이미 자격시험 카테고리에
// 속해있다"는 전제는 호출부(exam 화면은 requiresExam=true인 강좌만 진입)에서 이미
// 보장되므로 여기서 is_certification을 다시 확인하지 않는다.
async function getCourseExamBankCategoryId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string
): Promise<string | null> {
  const { data: course, error: courseError } = await supabase.from('courses').select('category_id').eq('id', courseId).maybeSingle();
  if (courseError) throw new Error(courseError.message);
  if (!course || !course.category_id) return null;

  const { data: category, error: categoryError } = await supabase
    .from('categories')
    .select('depth, parent_id')
    .eq('id', course.category_id)
    .maybeSingle();
  if (categoryError) throw new Error(categoryError.message);
  if (!category) return null;

  return category.depth >= 3 ? category.parent_id : (course.category_id as string);
}

export type AdminCourseExamLink = {
  linkId: string;
  bankQuestionId: string;
  question: string;
  order: number;
  options: AdminExamBankOption[];
};

// 강좌 시험 저작 화면(/admin/courses/[id]/exam)에서 "이 강좌 시험에 포함된 문항" 목록.
// 문항 내용은 이제 문제은행 소유라 여기서는 링크(순서·연결 여부)만 다룬다.
export async function getCourseExamQuestionsForCourse(courseId: string): Promise<AdminCourseExamLink[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('course_exam_question_links')
    .select('id, bank_question_id, order, exam_question_bank(question, exam_bank_options(id, label, is_correct, order))')
    .eq('course_id', courseId)
    .order('order', { ascending: true });
  if (error) throw new Error(error.message);

  return (
    data as unknown as {
      id: string;
      bank_question_id: string;
      order: number;
      exam_question_bank: { question: string; exam_bank_options: { id: string; label: string; is_correct: boolean; order: number }[] };
    }[]
  ).map((row) => ({
    linkId: row.id,
    bankQuestionId: row.bank_question_id,
    question: row.exam_question_bank.question,
    order: row.order,
    options: row.exam_question_bank.exam_bank_options
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((o) => ({ id: o.id, label: o.label, order: o.order, isCorrect: o.is_correct })),
  }));
}

// "문제은행 관리로 이동" 링크용 — 강좌가 속한 문제은행 스코프 카테고리 id.
export async function getCourseCertificationCategoryId(courseId: string): Promise<string | null> {
  const supabase = await createClient();
  return getCourseExamBankCategoryId(supabase, courseId);
}

// "문제은행에서 추가" 피커용 — 강좌의 문제은행 스코프 안에서 아직 이 강좌에 연결되지 않은 문항.
export async function getAvailableBankQuestionsForCourse(courseId: string): Promise<AdminExamBankQuestion[]> {
  const supabase = await createClient();
  const rootCategoryId = await getCourseExamBankCategoryId(supabase, courseId);
  if (!rootCategoryId) return [];

  const [bankQuestions, linkRows] = await Promise.all([
    getExamBankQuestionsForCategory(rootCategoryId),
    supabase.from('course_exam_question_links').select('bank_question_id').eq('course_id', courseId),
  ]);
  if (linkRows.error) throw new Error(linkRows.error.message);

  const linkedIds = new Set((linkRows.data as { bank_question_id: string }[]).map((r) => r.bank_question_id));
  return bankQuestions.filter((q) => !linkedIds.has(q.id));
}

// ===================== 과제 검토 (/admin/assignments, Phase 4.5) =====================
// assignment_submissions는 재제출 시 새 행이 쌓이므로(UPDATE 권한 없음), 검토 목록은
// (user_id, lesson_id)별 가장 최근 제출 1건만 보여준다 — classroom-queries.ts의
// getLatestAssignmentSubmissionsForCourse()와 동일한 "최신 우선" 원칙을 관리자 전체
// 조회로 확장한 것.

export type AdminAssignmentSubmission = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  lessonId: string;
  lessonTitle: string;
  courseId: string;
  courseTitle: string;
  status: AssignmentSubmissionStatus;
  content: string;
  isLate: boolean;
  submittedAt: string;
  reviewNote: string | null;
};

export async function getAdminAssignmentSubmissions(filters?: {
  status?: AssignmentSubmissionStatus | 'all';
}): Promise<AdminAssignmentSubmission[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('assignment_submissions')
    .select(
      'id, user_id, lesson_id, status, content, is_late, submitted_at, review_note, profiles(name, email), lessons(title, course_id, courses(title))'
    )
    .order('submitted_at', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = data as unknown as {
    id: string;
    user_id: string;
    lesson_id: string;
    status: AssignmentSubmissionStatus;
    content: string;
    is_late: boolean;
    submitted_at: string;
    review_note: string | null;
    profiles: { name: string; email: string | null };
    lessons: { title: string; course_id: string; courses: { title: string } };
  }[];

  const latestByKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.user_id}:${row.lesson_id}`;
    if (!latestByKey.has(key)) latestByKey.set(key, row);
  }

  const result: AdminAssignmentSubmission[] = [...latestByKey.values()].map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.profiles.name,
    userEmail: row.profiles.email,
    lessonId: row.lesson_id,
    lessonTitle: row.lessons.title,
    courseId: row.lessons.course_id,
    courseTitle: row.lessons.courses.title,
    status: row.status,
    content: row.content,
    isLate: row.is_late,
    submittedAt: row.submitted_at,
    reviewNote: row.review_note,
  }));

  if (filters?.status && filters.status !== 'all') {
    return result.filter((r) => r.status === filters.status);
  }
  return result;
}
