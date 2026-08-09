// Admin 콘솔(module-lms-6) 전용 조회 함수 모음.
// lib/supabase/queries.ts와 동일한 컨벤션(createClient() → select → snake_case→camelCase
// 매핑 → error 시 throw)을 따르되, 학습자 화면과 무관한 관리자 전용 조회가 많아 파일을 분리했다.
// RLS(is_admin())가 서버에서 이미 강제하므로 여기서 role을 다시 확인하지 않는다 — 이 함수들은
// admin 라우트(app/(admin)/*, proxy.ts가 role='admin'만 통과시킴)에서만 호출된다는 전제.

import { createClient } from '@/lib/supabase/server';
import { deriveStatus, collectDescendantIds, getApprovedSeatsTaken, getMyEnrollments } from '@/lib/supabase/queries';
import type {
  AssignmentSubmissionStatus,
  Course,
  CourseStatus,
  EnrollmentStatus,
  Lesson,
  LegalDocType,
  Profile,
  ProfileStatus,
  UserRole,
} from '@/lib/types';

// ===================== 공통 매핑 헬퍼 =====================

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
  status: CourseStatus;
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
    assignmentDueAt: row.assignment_due_at,
    hasQuiz: row.has_quiz,
    hasAssignment: row.has_assignment,
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
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();

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
};

// 승인된 신청 건별로 진도/과제 승인 현황을 계산한다. 대시보드 "수료임박"과 Admin 수료관리
// "수료 조건 충족자" 목록이 동일한 원자료를 서로 다른 기준으로 거르므로 여기서 한 번만 조회한다.
// module-lms-5(강의실)가 아직 없어 progress/assignment_submissions에 데이터가 쌓이지
// 않으므로, 이 함수는 당분간 빈 배열에 가까운 결과를 반환한다 — 의도된 동작이다.
async function getApprovedEnrollmentProgressStats(): Promise<ApprovedEnrollmentProgressStat[]> {
  const supabase = await createClient();

  const { data: enrollmentRows, error: enrollmentError } = await supabase
    .from('enrollments')
    .select('user_id, course_id, profiles(name), courses(title, lessons(id, has_assignment))')
    .eq('status', 'approved');
  if (enrollmentError) throw new Error(enrollmentError.message);

  const rows = enrollmentRows as unknown as {
    user_id: string;
    course_id: string;
    profiles: { name: string };
    courses: { title: string; lessons: { id: string; has_assignment: boolean }[] };
  }[];
  const candidates = rows.filter((r) => r.courses.lessons.length > 0);
  if (candidates.length === 0) return [];

  const userIds = [...new Set(candidates.map((r) => r.user_id))];

  const [certRes, progressRes, assignmentRes] = await Promise.all([
    supabase.from('certificates').select('user_id, course_id'),
    supabase.from('progress').select('user_id, lesson_id').in('user_id', userIds).not('completed_at', 'is', null),
    supabase.from('assignment_submissions').select('user_id, lesson_id').in('user_id', userIds).eq('status', 'approved'),
  ]);
  if (certRes.error) throw new Error(certRes.error.message);
  if (progressRes.error) throw new Error(progressRes.error.message);
  if (assignmentRes.error) throw new Error(assignmentRes.error.message);

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

  return candidates.map((r) => {
    const completedSet = completedLessonsByUser.get(r.user_id) ?? new Set<string>();
    const approvedSet = approvedAssignmentsByUser.get(r.user_id) ?? new Set<string>();
    return {
      userId: r.user_id,
      userName: r.profiles.name,
      courseId: r.course_id,
      courseTitle: r.courses.title,
      totalLessons: r.courses.lessons.length,
      completedLessons: r.courses.lessons.filter((l) => completedSet.has(l.id)).length,
      assignmentLessonIds: r.courses.lessons.filter((l) => l.has_assignment).map((l) => l.id),
      approvedAssignmentLessonIds: approvedSet,
      hasCertificate: certifiedSet.has(`${r.user_id}:${r.course_id}`),
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

// 수료 조건(flows.md Q7): 진도 100% + (과제가 있는 강의는 전부) 과제 승인, 미발급.
export async function getCertificateEligibleLearners(): Promise<CertificateEligibleLearner[]> {
  const stats = await getApprovedEnrollmentProgressStats();
  return stats
    .filter((s) => !s.hasCertificate && s.completedLessons === s.totalLessons)
    .filter((s) => s.assignmentLessonIds.every((id) => s.approvedAssignmentLessonIds.has(id)))
    .map((s) => ({ userId: s.userId, userName: s.userName, courseId: s.courseId, courseTitle: s.courseTitle }));
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
    .select('id, slug, title, fee, seats, status, categories(name)')
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
    categories: { name: string } | null;
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
  }));
}

export type AdminCourseDetail = Course & { lessons: Lesson[] };

export async function getAdminCourseById(id: string): Promise<AdminCourseDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('courses')
    .select(
      'id, slug, title, category_id, description, instructor, fee, seats, government_support, status, lessons(id, course_id, title, video_url, order, has_quiz, has_assignment, assignment_due_at)'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as unknown as CourseRow & { lessons: LessonRow[] };
  return {
    ...mapCourseRow(row),
    lessons: row.lessons
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(mapLessonRow),
  };
}

// ===================== 카테고리 관리 (/admin/categories) =====================

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

export async function getAdminMembers(params?: { q?: string; status?: ProfileStatus | 'all' }): Promise<AdminMemberListItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from('profiles')
    .select('id, name, email, phone, role, status, created_at')
    .order('created_at', { ascending: false });

  if (params?.status && params.status !== 'all') query = query.eq('status', params.status);
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
  enrollments: Awaited<ReturnType<typeof getMyEnrollments>>;
  certificates: { id: string; courseId: string; courseTitle: string; issuedAt: string; isManualOverride: boolean; note: string | null }[];
};

export async function getAdminMemberDetail(userId: string): Promise<AdminMemberDetail | null> {
  const supabase = await createClient();
  const { data: profileRow, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, phone, email, role, status, withdrawn_at')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profileRow) return null;

  const [enrollments, certRows] = await Promise.all([
    getMyEnrollments(userId),
    supabase.from('certificates').select('id, course_id, issued_at, is_manual_override, note, courses(title)').eq('user_id', userId),
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
    },
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
