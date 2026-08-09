import type { Metadata } from 'next';
import Link from 'next/link';
import { deactivateCourse, deleteCourse } from '@/app/actions/admin-courses';
import StatusBadge from '@/components/admin/StatusBadge';
import AdminTable from '@/components/admin/AdminTable';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { getAdminCourses } from '@/lib/supabase/admin-queries';
import type { CourseStatus } from '@/lib/types';

export const metadata: Metadata = { title: '강좌 관리 | 관리자' };

const STATUS_LABEL: Record<CourseStatus, string> = { active: '진행중', upcoming: '예정', closed: '비활성' };
const STATUS_TONE: Record<CourseStatus, 'neutral' | 'success' | 'warning'> = {
  active: 'success',
  upcoming: 'warning',
  closed: 'neutral',
};

const SUCCESS_MESSAGE: Record<string, string> = {
  deactivated: '강좌를 비활성화했어요.',
  deleted: '강좌를 삭제했어요.',
};
const ERROR_MESSAGE: Record<string, string> = {
  'has-history': '신청·수료 이력이 있는 강좌는 삭제할 수 없어요. 대신 비활성화해주세요.',
  failed: '처리 중 문제가 발생했어요.',
};

export default async function AdminCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const courses = await getAdminCourses();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-n-9">강좌 관리</h1>
        <Link href="/admin/courses/new" className="rounded-pill bg-pink px-4 py-2 text-[13px] font-semibold text-white">
          강좌 등록
        </Link>
      </div>

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

      <AdminTable>
        <thead>
          <tr>
            <th>강좌명</th>
            <th>카테고리</th>
            <th>수강료</th>
            <th>정원/승인</th>
            <th>상태</th>
            <th>액션</th>
          </tr>
        </thead>
        <tbody>
          {courses.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-10 text-center text-n-6">
                등록된 강좌가 없어요
              </td>
            </tr>
          ) : (
            courses.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/admin/courses/${c.id}`} className="font-medium text-n-9">
                    {c.title}
                  </Link>
                </td>
                <td>{c.categoryName ?? '-'}</td>
                <td>{c.fee.toLocaleString('ko-KR')}원</td>
                <td>
                  {c.approvedCount}/{c.seats}
                  {c.approvedCount > c.seats && <span className="ml-1 text-danger">초과</span>}
                </td>
                <td>
                  <StatusBadge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</StatusBadge>
                </td>
                <td>
                  <div className="flex gap-1.5">
                    <Link
                      href={`/admin/courses/${c.id}`}
                      className="rounded-pill border border-n-3 px-3 py-1.5 text-[12px] font-medium text-n-7"
                    >
                      수정
                    </Link>
                    {c.status !== 'closed' && (
                      <ConfirmDialog
                        triggerLabel="비활성화"
                        title="강좌를 비활성화할까요?"
                        description={
                          c.enrollmentCount > 0
                            ? `이미 신청 ${c.enrollmentCount}건이 있어요. 계속할까요?`
                            : '공개 목록에서 더 이상 노출되지 않아요.'
                        }
                        confirmLabel="비활성화"
                        action={deactivateCourse.bind(null, c.id)}
                      />
                    )}
                    <ConfirmDialog
                      triggerLabel="삭제"
                      triggerClassName="rounded-pill border border-danger px-3 py-1.5 text-[12px] font-medium text-danger"
                      title="강좌를 삭제할까요?"
                      description="되돌릴 수 없어요."
                      confirmLabel="삭제"
                      tone="danger"
                      disabled={c.enrollmentCount > 0 || c.certificateCount > 0}
                      disabledReason={`신청 ${c.enrollmentCount}건, 수료 ${c.certificateCount}건이 있어 삭제할 수 없어요. 대신 비활성화해주세요.`}
                      action={deleteCourse.bind(null, c.id)}
                    />
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
