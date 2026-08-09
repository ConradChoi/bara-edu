import { createClient } from '@/lib/supabase/server';
import type { Category, Course, EnrollmentStatus } from '@/lib/types';

type CategoryRow = {
  id: string;
  name: string;
  parent_id: string | null;
  depth: number;
  order: number;
  is_active: boolean;
};

function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    depth: row.depth as 1 | 2 | 3,
    order: row.order,
    isActive: row.is_active,
  };
}

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

function mapCourse(row: CourseRow): Course {
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

export async function getCategoryTree(): Promise<Category[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, parent_id, depth, order, is_active')
    .order('depth', { ascending: true })
    .order('order', { ascending: true });

  if (error) throw new Error(error.message);
  return (data as CategoryRow[]).map(mapCategory);
}

// 상위 카테고리 선택 시 하위 전체 포함 (F-PUB-2). Admin 카테고리 삭제/비활성화 시
// "본인+하위가 쓰이고 있는지" 판정에도 재사용한다(module-lms-6).
export function collectDescendantIds(categoryId: string, categories: Category[]): string[] {
  const ids = [categoryId];
  const children = categories.filter((c) => c.parentId === categoryId);
  for (const child of children) {
    ids.push(...collectDescendantIds(child.id, categories));
  }
  return ids;
}

export async function getPublicCourses(categoryId?: string): Promise<Course[]> {
  const supabase = await createClient();
  let query = supabase
    .from('courses')
    .select('id, slug, title, category_id, description, instructor, fee, seats, government_support, status')
    .in('status', ['active', 'upcoming']);

  if (categoryId) {
    const categories = await getCategoryTree();
    const ids = collectDescendantIds(categoryId, categories);
    query = query.in('category_id', ids);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data as CourseRow[]).map(mapCourse);
}

// status 필터는 애플리케이션 코드가 아니라 RLS(courses_public_select/courses_enrolled_select)에
// 맡긴다 — 여기서 in('status', [...])로 한 번 더 거르면, closed로 바뀐 강좌를 계속 봐야 하는
// 승인된 학습자(RLS는 허용)까지 404가 나는 문제가 있었다(module-lms-7 통합 점검, 2026-08-09).
export async function getCourseBySlug(slug: string): Promise<Course | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('courses')
    .select('id, slug, title, category_id, description, instructor, fee, seats, government_support, status')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapCourse(data as CourseRow) : null;
}

export async function getCategoryById(id: string, categories: Category[]): Promise<Category | undefined> {
  return categories.find((c) => c.id === id);
}

// 정원 마감 판정 기준: 승인된(approved) 신청 건수 (flows.md Q3 — 정원 마감은 승인 시점 기준)
export async function getApprovedSeatsTaken(courseIds: string[]): Promise<Record<string, number>> {
  if (courseIds.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('enrollments')
    .select('course_id')
    .eq('status', 'approved')
    .in('course_id', courseIds);

  if (error) throw new Error(error.message);
  return (data as { course_id: string }[]).reduce<Record<string, number>>((acc, row) => {
    acc[row.course_id] = (acc[row.course_id] ?? 0) + 1;
    return acc;
  }, {});
}

// 'expired'는 아직 어떤 코드도 자동 기록하지 않는다(design.md 3.2 구현 메모) —
// payment_due_at을 넘긴 pending 건은 여기서 파생 상태로만 만료 처리한다.
// Admin 신청·입금 목록(module-lms-6)에서도 동일한 파생 규칙을 재사용한다.
export function deriveStatus(status: EnrollmentStatus, paymentDueAt: string): EnrollmentStatus {
  if (status === 'pending' && new Date(paymentDueAt) < new Date()) return 'expired';
  return status;
}

export type MyEnrollment = {
  id: string;
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  fee: number;
  status: EnrollmentStatus;
  paymentDueAt: string;
  createdAt: string;
  rejectionReason: string | null;
};

type EnrollmentWithCourseRow = {
  id: string;
  course_id: string;
  status: EnrollmentStatus;
  payment_due_at: string;
  created_at: string;
  rejection_reason: string | null;
  courses: { title: string; slug: string; fee: number };
};

export async function getMyEnrollments(userId: string): Promise<MyEnrollment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('enrollments')
    .select('id, course_id, status, payment_due_at, created_at, rejection_reason, courses(title, slug, fee)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data as unknown as EnrollmentWithCourseRow[]).map((row) => ({
    id: row.id,
    courseId: row.course_id,
    courseTitle: row.courses.title,
    courseSlug: row.courses.slug,
    fee: row.courses.fee,
    status: deriveStatus(row.status, row.payment_due_at),
    paymentDueAt: row.payment_due_at,
    createdAt: row.created_at,
    rejectionReason: row.rejection_reason,
  }));
}

export type MyEnrollmentForCourse = {
  id: string;
  status: EnrollmentStatus;
  paymentDueAt: string;
  rejectionReason: string | null;
};

export async function getMyEnrollmentForCourse(
  userId: string,
  courseId: string
): Promise<MyEnrollmentForCourse | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('enrollments')
    .select('id, status, payment_due_at, rejection_reason')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    status: deriveStatus(data.status, data.payment_due_at),
    paymentDueAt: data.payment_due_at,
    rejectionReason: data.rejection_reason,
  };
}

export type LegalDocument = { slug: string; title: string; content: string; version: number };

export async function getLegalDocument(slug: string): Promise<LegalDocument | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('legal_documents')
    .select('slug, title, content, version')
    .eq('slug', slug)
    .eq('is_published', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as LegalDocument | null;
}

