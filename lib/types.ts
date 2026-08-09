// bara-edu-lms 타입 정의
// 근거: docs/02-design/features/bara-edu-lms.design.md 3.1
// Supabase 테이블(snake_case)은 lib/supabase/queries.ts에서 아래 camelCase 타입으로 매핑한다.

export type UserRole = 'learner' | 'admin';
export type ProfileStatus = 'active' | 'withdrawn';

export interface Profile {
  id: string; // Supabase auth.users.id
  name: string;
  phone?: string;
  email?: string | null; // auth.users.email의 복제본(관리자 검색용, module-lms-6). 탈퇴 시 함께 익명화됨.
  role: UserRole;
  status: ProfileStatus;
  withdrawnAt: string | null;
}

// 카테고리: 최대 3Depth 트리 (예: IT·디지털 > 개발 > 프론트엔드)
export interface Category {
  id: string;
  name: string;
  parentId: string | null; // null이면 1Depth(최상위)
  depth: 1 | 2 | 3;
  order: number;
  isActive: boolean; // 삭제 대신 비활성화 (F-ADMCAT-3)
}

export type CourseStatus = 'active' | 'upcoming' | 'closed';

export interface Course {
  id: string;
  slug: string; // /courses/[slug] 라우트에 사용
  title: string;
  categoryId: string; // Category 참조
  description: string;
  instructor: string;
  fee: number;
  seats: number;
  governmentSupport: boolean;
  status: CourseStatus;
}

export interface Lesson {
  id: string;
  courseId: string;
  title: string;
  videoUrl: string | null; // 외부 링크 (업로드 아님). DB 컬럼이 nullable — 관리자가 아직 안 넣었을 수 있음.
  order: number;
  hasQuiz: boolean;
  hasAssignment: boolean;
  assignmentDueAt: string | null; // 과제 마감기한. null이면 마감 없음(module-lms-5)
}

// 학습자 화면용 퀴즈 타입 — is_correct 필드가 없다(정답 유출 방지).
// get_quiz_for_lesson() RPC 응답과 1:1 대응. 관리자 전용(isCorrect 포함) 타입은
// lib/supabase/admin-queries.ts에 별도로 둔다.
export interface QuizOption {
  id: string;
  label: string;
  order: number;
}

export interface QuizQuestionWithOptions {
  id: string;
  question: string;
  order: number;
  options: QuizOption[];
}

export type EnrollmentStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface Enrollment {
  id: string;
  userId: string;
  courseId: string;
  status: EnrollmentStatus;
  paymentMethod: 'bank_transfer'; // PG 도입 전까지 고정값
  paymentDueAt: string; // 신청 시점 + 3일
  rejectionReason: string | null; // 반려/승인취소 사유 (F-ADME-3)
  approvedAt: string | null; // 대시보드 "오늘 승인" 집계용 (F-ADM-1)
}

export interface Progress {
  userId: string;
  lessonId: string;
  completedAt: string | null; // 사용자가 "학습 완료로 표시" 클릭 시 기록
}

export interface QuizSubmission {
  id: string;
  userId: string;
  lessonId: string;
  score: number;
  attemptNo: number; // 무제한 허용
}

export type AssignmentSubmissionStatus = 'submitted' | 'approved' | 'rejected';

export interface AssignmentSubmission {
  id: string;
  userId: string;
  lessonId: string;
  content: string; // 텍스트 또는 링크
  status: AssignmentSubmissionStatus;
  isLate: boolean; // 마감 초과 여부만 표시, 감점 없음
}

export interface Certificate {
  id: string;
  userId: string;
  courseId: string;
  issuedAt: string;
  fileUrl: string | null;
  isManualOverride: boolean;
  note: string | null; // 수동 수료 처리 사유 (F-ADMCE-3)
}

export type LegalDocType = 'terms' | 'privacy' | 'refund_policy' | 'etc';

export interface LegalDocument {
  id: string;
  type: LegalDocType;
  slug: string;
  title: string;
  content: string; // 마크다운
  version: number;
  isPublished: boolean;
  effectiveAt: string;
}

export interface SiteConfig {
  name: string;
  phone: string;
  email: string;
  address: string;
  kakaoUrl?: string;
  instagramUrl?: string;
  openingDate?: string;
  isOpen: boolean;
}
