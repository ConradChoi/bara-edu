import Link from 'next/link';
import { issueCertificateSelf } from '@/app/actions/classroom';
import type { CertificateEligibility } from '@/lib/supabase/classroom-queries';

// 진도 100% + 과제 전건 승인(Q7)일 때만 발급 가능. 실제 게이트는 issue_certificate_self()
// RPC가 서버에서 재검증하며, 여기서는 버튼 상태와 "부족한 항목" 안내만 담당한다.
export default function CertificateAction({
  courseId,
  lessonId,
  eligibility,
}: {
  courseId: string;
  lessonId: string;
  eligibility: CertificateEligibility;
}) {
  if (eligibility.alreadyIssued) {
    return (
      <Link href="/my?tab=certificates" className="text-[12.5px] font-medium text-pink underline">
        수료증 확인하기
      </Link>
    );
  }

  if (!eligibility.eligible) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled
          className="rounded-pill bg-n-3 px-4 py-2 text-[13px] font-medium text-n-6 disabled:cursor-not-allowed"
        >
          수료증 발급받기
        </button>
        <p className="text-[11.5px] text-n-5">
          진도 {eligibility.completedLessons}/{eligibility.totalLessons}
          {eligibility.pendingAssignmentLessonTitles.length > 0 &&
            ` · 과제 승인 대기: ${eligibility.pendingAssignmentLessonTitles.join(', ')}`}
        </p>
      </div>
    );
  }

  return (
    <form action={issueCertificateSelf.bind(null, courseId, lessonId)}>
      <button type="submit" className="rounded-pill bg-pink px-4 py-2 text-[13px] font-semibold text-white">
        수료증 발급받기
      </button>
    </form>
  );
}
