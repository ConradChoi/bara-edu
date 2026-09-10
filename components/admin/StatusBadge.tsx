type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-n-2 text-n-6',
  info: 'bg-info/15 text-info', // 자격시험 "응시 가능" 배지용(2026-09-09 추가) — components/courses/Badge.tsx와 동일 토큰
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
};

// /my 페이지의 STATUS_TONE 배지 스타일을 Admin 화면(enrollments/courses/certificates)에서
// 공유하기 위한 컴포넌트.
export default function StatusBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`rounded-pill px-2.5 py-1 text-[11px] font-semibold ${TONE_CLASS[tone]}`}>{children}</span>;
}
