import type { Metadata } from 'next';
import { approveEnrollment, rejectEnrollment, unapproveEnrollment } from '@/app/actions/admin-enrollments';
import AdminTable from '@/components/admin/AdminTable';
import StatusBadge from '@/components/admin/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { getAdminEnrollments } from '@/lib/supabase/admin-queries';
import type { EnrollmentStatus } from '@/lib/types';

export const metadata: Metadata = { title: '신청·입금 관리 | 관리자' };

const FILTERS: { key: EnrollmentStatus | 'all'; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'pending', label: '대기' },
  { key: 'approved', label: '승인' },
  { key: 'rejected', label: '반려' },
];

const STATUS_LABEL: Record<EnrollmentStatus, string> = {
  pending: '대기',
  approved: '승인',
  rejected: '반려',
  expired: '만료',
};

const STATUS_TONE: Record<EnrollmentStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  expired: 'neutral',
};

const SUCCESS_MESSAGE: Record<string, string> = {
  approved: '승인 처리되었어요.',
  rejected: '반려 처리되었어요.',
  unapproved: '승인이 취소됐어요.',
};

const ERROR_MESSAGE: Record<string, string> = {
  'already-processed': '이미 처리된 신청이에요.',
  'reason-required': '사유를 입력해야 해요.',
  failed: '처리 중 문제가 발생했어요.',
};

export default async function AdminEnrollmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; success?: string; error?: string }>;
}) {
  const { status, success, error } = await searchParams;
  const filter = (FILTERS.some((f) => f.key === status) ? status : 'all') as EnrollmentStatus | 'all';
  const enrollments = await getAdminEnrollments({ status: filter });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[20px] font-semibold text-n-9">신청·입금 관리</h1>

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
            href={f.key === 'all' ? '/admin/enrollments' : `/admin/enrollments?status=${f.key}`}
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
            <th>강좌명</th>
            <th>수강료</th>
            <th>신청일</th>
            <th>상태</th>
            <th>액션</th>
          </tr>
        </thead>
        <tbody>
          {enrollments.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-10 text-center text-n-6">
                신청 내역이 없어요
              </td>
            </tr>
          ) : (
            enrollments.map((e) => (
              <tr key={e.id}>
                <td>
                  <div className="flex flex-col">
                    <span className="font-medium text-n-9">{e.userName}</span>
                    <span className="text-[11.5px] text-n-5">{e.userEmail}</span>
                  </div>
                </td>
                <td>{e.courseTitle}</td>
                <td>{e.fee.toLocaleString('ko-KR')}원</td>
                <td>{new Date(e.createdAt).toLocaleDateString('ko-KR')}</td>
                <td>
                  <StatusBadge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</StatusBadge>
                  {e.status === 'rejected' && e.rejectionReason && (
                    <p className="mt-1 text-[11px] text-n-5">{e.rejectionReason}</p>
                  )}
                </td>
                <td>
                  <div className="flex gap-1.5">
                    {(e.status === 'pending' || e.status === 'expired') && (
                      <>
                        <ConfirmDialog
                          triggerLabel="승인"
                          title="입금을 확인했나요?"
                          description={`${e.userName}님의 "${e.courseTitle}" 신청을 승인합니다.`}
                          confirmLabel="승인"
                          action={approveEnrollment.bind(null, e.id)}
                        />
                        <ConfirmDialog
                          triggerLabel="반려"
                          title="신청을 반려할까요?"
                          description="반려 사유는 학습자에게 그대로 노출돼요."
                          confirmLabel="반려"
                          tone="danger"
                          action={rejectEnrollment.bind(null, e.id)}
                          reasonField={{ name: 'reason', label: '반려 사유', placeholder: '예: 입금 미확인' }}
                        />
                      </>
                    )}
                    {e.status === 'approved' && (
                      <ConfirmDialog
                        triggerLabel="승인취소"
                        title="승인을 취소할까요?"
                        description="학습자의 강의실 접근 권한이 즉시 사라져요. 되돌릴 수 없어요."
                        confirmLabel="승인취소"
                        tone="danger"
                        action={unapproveEnrollment.bind(null, e.id)}
                        reasonField={{ name: 'reason', label: '취소 사유', placeholder: '예: 오승인' }}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </AdminTable>
    </div>
  );
}
