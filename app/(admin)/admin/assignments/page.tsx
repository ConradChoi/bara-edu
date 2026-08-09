import type { Metadata } from 'next';
import { approveAssignment, rejectAssignment } from '@/app/actions/admin-assignments';
import AdminTable from '@/components/admin/AdminTable';
import StatusBadge from '@/components/admin/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { getAdminAssignmentSubmissions } from '@/lib/supabase/admin-queries';
import type { AssignmentSubmissionStatus } from '@/lib/types';

export const metadata: Metadata = { title: '과제 검토 | 관리자' };

const FILTERS: { key: AssignmentSubmissionStatus | 'all'; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'submitted', label: '대기' },
  { key: 'approved', label: '승인' },
  { key: 'rejected', label: '반려' },
];

const STATUS_LABEL: Record<AssignmentSubmissionStatus, string> = {
  submitted: '대기',
  approved: '승인',
  rejected: '반려',
};

const STATUS_TONE: Record<AssignmentSubmissionStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  submitted: 'warning',
  approved: 'success',
  rejected: 'danger',
};

const SUCCESS_MESSAGE: Record<string, string> = {
  approved: '승인 처리됐어요.',
  rejected: '반려 처리됐어요.',
};

const ERROR_MESSAGE: Record<string, string> = {
  'already-processed': '이미 처리된 과제예요.',
  'reason-required': '반려 사유를 입력해야 해요.',
  failed: '처리 중 문제가 발생했어요.',
};

export default async function AdminAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; success?: string; error?: string }>;
}) {
  const { status, success, error } = await searchParams;
  const filter = (FILTERS.some((f) => f.key === status) ? status : 'all') as AssignmentSubmissionStatus | 'all';
  const submissions = await getAdminAssignmentSubmissions({ status: filter });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[20px] font-semibold text-n-9">과제 검토</h1>

      {success && SUCCESS_MESSAGE[success] && (
        <div className="rounded-md border border-success bg-success/10 px-3.5 py-3 text-[13px] font-medium text-success">
          {SUCCESS_MESSAGE[success]}
        </div>
      )}
      {error && ERROR_MESSAGE[error] && (
        <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          {ERROR_MESSAGE[error]}
        </div>
      )}

      <nav className="flex gap-1 border-b border-n-3">
        {FILTERS.map((f) => (
          <a
            key={f.key}
            href={f.key === 'all' ? '/admin/assignments' : `/admin/assignments?status=${f.key}`}
            className={`px-4 py-2.5 text-[13px] font-medium ${
              filter === f.key ? 'border-b-2 border-pink text-pink' : 'text-n-6'
            }`}
          >
            {f.label}
          </a>
        ))}
      </nav>

      <AdminTable>
        <thead>
          <tr>
            <th>이름</th>
            <th>강좌 / 강의</th>
            <th>제출 내용</th>
            <th>제출일</th>
            <th>상태</th>
            <th>액션</th>
          </tr>
        </thead>
        <tbody>
          {submissions.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-10 text-center text-n-6">
                제출된 과제가 없어요
              </td>
            </tr>
          ) : (
            submissions.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="flex flex-col">
                    <span className="font-medium text-n-9">{s.userName}</span>
                    <span className="text-[11.5px] text-n-5">{s.userEmail}</span>
                  </div>
                </td>
                <td>
                  <div className="flex flex-col">
                    <span>{s.courseTitle}</span>
                    <span className="text-[11.5px] text-n-5">{s.lessonTitle}</span>
                  </div>
                </td>
                <td className="max-w-[240px]">
                  <p className="line-clamp-3 whitespace-pre-wrap text-[12.5px]">{s.content}</p>
                </td>
                <td>
                  {new Date(s.submittedAt).toLocaleDateString('ko-KR')}
                  {s.isLate && (
                    <span className="ml-1">
                      <StatusBadge tone="neutral">기한 초과</StatusBadge>
                    </span>
                  )}
                </td>
                <td>
                  <StatusBadge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</StatusBadge>
                  {s.status === 'rejected' && s.reviewNote && <p className="mt-1 text-[11px] text-n-5">{s.reviewNote}</p>}
                </td>
                <td>
                  {s.status === 'submitted' && (
                    <div className="flex gap-1.5">
                      <ConfirmDialog
                        triggerLabel="승인"
                        title="과제를 승인할까요?"
                        description={`${s.userName}님의 "${s.lessonTitle}" 과제를 승인합니다.`}
                        confirmLabel="승인"
                        action={approveAssignment.bind(null, s.id)}
                      />
                      <ConfirmDialog
                        triggerLabel="반려"
                        title="과제를 반려할까요?"
                        description="반려 사유는 학습자에게 그대로 노출돼요."
                        confirmLabel="반려"
                        tone="danger"
                        action={rejectAssignment.bind(null, s.id)}
                        reasonField={{ name: 'reason', label: '반려 사유', placeholder: '예: 요구사항 미충족' }}
                      />
                    </div>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </AdminTable>
    </div>
  );
}
