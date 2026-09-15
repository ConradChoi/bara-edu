import type { Metadata } from 'next';
import Link from 'next/link';
import { closeLead, hideDiagnosisLeadContact, markLeadContacted, revealDiagnosisLeadContact, updateLeadNote } from '@/app/actions/admin-diagnosis';
import AdminTable from '@/components/admin/AdminTable';
import StatusBadge from '@/components/admin/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import FormDialog from '@/components/ui/FormDialog';
import { getAdminDiagnosisLeads } from '@/lib/supabase/admin-queries';

export const metadata: Metadata = { title: '강사과정 관심 문의 | 관리자' };

const STATUS_LABEL: Record<string, string> = { new: '신규', contacted: '연락함', closed: '종료' };
const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success'> = { new: 'neutral', contacted: 'info', closed: 'success' };

const SUCCESS_MESSAGE: Record<string, string> = {
  contacted: '연락함으로 표시했어요.',
  closed: '종료 처리했어요.',
  'note-updated': '메모를 수정했어요.',
};
const ERROR_MESSAGE: Record<string, string> = {
  failed: '처리 중 문제가 발생했어요.',
  'already-processed': '다른 관리자가 이미 처리했어요.',
  'reason-required': '종료 사유를 입력해주세요.',
  'reveal-failed': '개인정보 보기 처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요. 계속되면 관리자에게 문의해주세요.',
};

export default async function AdminDiagnosisLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ revealPii?: string; revealToken?: string; revealExp?: string; success?: string; error?: string }>;
}) {
  const { revealPii, revealToken, revealExp, success, error } = await searchParams;
  const leads = await getAdminDiagnosisLeads(undefined, {
    id: revealPii,
    token: revealToken,
    exp: revealExp ? Number(revealExp) : undefined,
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[20px] font-semibold text-n-9">강사과정 관심 문의</h1>

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
            <th>접수일시</th>
            <th>이름</th>
            <th>연락처</th>
            <th>메모</th>
            <th>연결결과</th>
            <th>상태</th>
            <th>액션</th>
          </tr>
        </thead>
        <tbody>
          {leads.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-10 text-center text-n-6">
                접수된 문의가 없어요.
              </td>
            </tr>
          ) : (
            leads.map((lead) => (
              <tr key={lead.id}>
                <td>{new Date(lead.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{lead.name}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <span>{lead.contact}</span>
                    {lead.isRevealed ? (
                      <form action={hideDiagnosisLeadContact}>
                        <button type="submit" className="rounded-pill border border-n-3 px-2 py-0.5 text-[10.5px] text-n-7">
                          가리기
                        </button>
                      </form>
                    ) : (
                      <form action={revealDiagnosisLeadContact.bind(null, lead.id)}>
                        <button type="submit" className="rounded-pill border border-n-3 px-2 py-0.5 text-[10.5px] text-n-7">
                          개인정보 보기
                        </button>
                      </form>
                    )}
                  </div>
                </td>
                <td className="max-w-[180px] truncate">{lead.message ?? '-'}</td>
                <td>
                  {lead.resultId ? (
                    <Link href={`/admin/selfcheck/${lead.resultId}`} className="text-[12px] font-medium text-indigo underline">
                      진단결과 보기
                    </Link>
                  ) : (
                    '-'
                  )}
                </td>
                <td>
                  <StatusBadge tone={STATUS_TONE[lead.status] ?? 'neutral'}>{STATUS_LABEL[lead.status] ?? lead.status}</StatusBadge>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1.5">
                    {lead.status === 'new' && (
                      <>
                        <ConfirmDialog
                          triggerLabel="연락함으로 표시"
                          title="연락함으로 표시할까요?"
                          description="통화 메모가 있으면 함께 남길 수 있어요."
                          confirmLabel="표시"
                          action={markLeadContacted.bind(null, lead.id)}
                          reasonField={{ name: 'note', label: '메모 (선택)', placeholder: '통화 내용 등', required: false }}
                        />
                        <ConfirmDialog
                          triggerLabel="바로 종료"
                          triggerClassName="rounded-pill border border-danger px-3 py-1.5 text-[12px] font-medium text-danger"
                          title="문의를 바로 종료할까요?"
                          description="종료 사유를 입력해주세요."
                          confirmLabel="종료"
                          tone="danger"
                          action={closeLead.bind(null, lead.id, 'new')}
                          reasonField={{ name: 'reason', label: '종료 사유 *', placeholder: '예: 중복 접수, 연락 불가' }}
                        />
                      </>
                    )}
                    {lead.status === 'contacted' && (
                      <ConfirmDialog
                        triggerLabel="종료 처리"
                        title="문의를 종료할까요?"
                        description="종료 사유를 입력해주세요."
                        confirmLabel="종료"
                        action={closeLead.bind(null, lead.id, 'contacted')}
                        reasonField={{ name: 'reason', label: '종료 사유 *', placeholder: '예: 강사과정 안내 완료' }}
                      />
                    )}
                    <FormDialog
                      triggerLabel="메모 수정"
                      triggerClassName="rounded-pill border border-n-3 px-3 py-1.5 text-[12px] font-medium text-n-7"
                      title="메모 수정"
                      action={updateLeadNote.bind(null, lead.id)}
                    >
                      <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
                        메모
                        <textarea
                          name="note"
                          defaultValue={lead.adminNote ?? ''}
                          className="min-h-[80px] rounded-md border border-n-3 bg-n-1 p-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
                        />
                      </label>
                    </FormDialog>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </AdminTable>

      <p className="text-[11.5px] text-n-5">
        &quot;개인정보 보기&quot;를 누르면 연락처 원문이 표시되고, 이 열람은 접속기록(admin_access_logs)에 남습니다.
      </p>
    </div>
  );
}
