import { submitAssignment } from '@/app/actions/classroom';
import StatusBadge from '@/components/admin/StatusBadge';
import type { AssignmentSubmissionStatus } from '@/lib/types';

const STATUS_LABEL: Record<AssignmentSubmissionStatus, string> = {
  submitted: '검토 대기',
  approved: '승인',
  rejected: '반려',
};

const STATUS_TONE: Record<AssignmentSubmissionStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  submitted: 'warning',
  approved: 'success',
  rejected: 'danger',
};

type LatestSubmission = {
  status: AssignmentSubmissionStatus;
  content: string;
  isLate: boolean;
  submittedAt: string;
  reviewNote: string | null;
} | null;

// F-LRN-5: 텍스트/링크 제출. 기한 초과해도 제출 가능(Q6, 감점 없음). 재제출은 새 시도로
// 처리되므로(UPDATE 권한 없음), 반려 후에도 같은 폼으로 다시 제출하면 된다.
export default function AssignmentForm({
  lessonId,
  courseId,
  latest,
}: {
  lessonId: string;
  courseId: string;
  latest: LatestSubmission;
}) {
  return (
    <div className="flex flex-col gap-3">
      {latest && (
        <div className="rounded-md border border-n-3 bg-n-1 p-3 text-[12.5px]">
          <div className="flex items-center gap-2">
            <StatusBadge tone={STATUS_TONE[latest.status]}>{STATUS_LABEL[latest.status]}</StatusBadge>
            {latest.isLate && <StatusBadge tone="neutral">기한 초과</StatusBadge>}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-n-7">{latest.content}</p>
          {latest.status === 'rejected' && latest.reviewNote && (
            <p className="mt-2 text-[11.5px] text-danger">반려 사유: {latest.reviewNote}</p>
          )}
        </div>
      )}
      {latest?.status === 'approved' ? (
        <p className="text-[12px] text-n-6">이미 승인된 과제예요. 다시 제출하면 재검토가 필요해요.</p>
      ) : (
        <form action={submitAssignment.bind(null, lessonId, courseId)} className="flex flex-col gap-2">
          <textarea
            name="content"
            required
            placeholder="과제 내용을 입력하거나 링크를 붙여넣으세요"
            className="min-h-[100px] rounded-md border border-n-3 bg-n-1 p-2.5 text-[13px]"
          />
          <button type="submit" className="h-10 self-start rounded-pill bg-pink px-4 text-[13px] font-semibold text-white">
            {latest ? '다시 제출하기' : '제출하기'}
          </button>
        </form>
      )}
    </div>
  );
}
