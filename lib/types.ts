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
  address: string | null; // 수강신청 확인 화면에서 회원당 1회 입력받아 재사용(자격증 발급용). 탈퇴 시 익명화됨.
  photoPath: string | null; // private 버킷(member-photos) 안의 객체 경로. 공개 URL 아님 — Admin은 서명 URL로만 조회.
}

// 입금 계좌(무통장입금 안내, Admin 관리 최대 3개)
export interface BankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  order: number;
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

export type CourseScheduleType = 'weekday' | 'weekend' | 'both';

export interface Course {
  id: string;
  slug: string; // /courses/[slug] 라우트에 사용
  title: string;
  categoryId: string; // Category 참조
  description: string;
  instructor: string;
  fee: number;
  seats: number;
  totalHours: number | null; // 총 강좌 시간(단위: 시간), 미입력 시 null
  startDate: string | null; // 강좌 시작 년월일("YYYY-MM-DD"), 미입력 시 null
  endDate: string | null; // 강좌 종료 년월일("YYYY-MM-DD"), 미입력 시 null
  scheduleType: CourseScheduleType | null; // 평일반/주말반/평일+주말반, 미입력 시 null
  requiresCertificateInfo: boolean; // 수강신청 시 주소·사진(자격증 발급용) 필수 요구 여부
  governmentSupport: boolean;
  status: CourseStatus;
}

export type LessonMode = 'video' | 'online' | 'offline';

export interface Lesson {
  id: string;
  courseId: string;
  title: string;
  videoUrl: string | null; // 외부 링크 (업로드 아님). DB 컬럼이 nullable — 관리자가 아직 안 넣었을 수 있음.
  order: number;
  hasQuiz: boolean;
  hasAssignment: boolean;
  assignmentDueAt: string | null; // 과제 마감기한. null이면 마감 없음(module-lms-5)
  lessonMode: LessonMode; // 강의 방식(2026-08-25 추가). 기존 강의는 전부 'video'로 마이그레이션됨
  onlineMeetingUrl: string | null; // lessonMode='online'일 때만 사용. 회의 참여 링크
  onlineScheduledAt: string | null; // lessonMode='online'일 때 선택 입력. 실시간 수업 일시
  offlineLocationName: string | null; // lessonMode='offline'일 때 선택 입력
  offlineAddress: string | null; // lessonMode='offline'일 때 선택 입력
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
  operator: string;
  representative: string;
  businessRegistrationNumber: string;
  mailOrderLicenseNumber: string;
  phone: string;
  email: string;
  address: string;
  kakaoUrl?: string;
  instagramUrl?: string;
  openingDate?: string;
  isOpen: boolean;
}
