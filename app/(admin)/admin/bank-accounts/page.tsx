import type { Metadata } from 'next';
import { createBankAccount, deleteBankAccount, updateBankAccount } from '@/app/actions/admin-bank-accounts';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { getBankAccounts } from '@/lib/supabase/queries';

export const metadata: Metadata = { title: '계좌정보 관리 | 관리자' };

// 실제 제한은 supabase/schema.sql의 enforce_bank_accounts_limit() 트리거가 강제한다 —
// 이 값은 화면 표시("추가" 폼 노출 여부)용이라 트리거와 반드시 같은 값으로 유지해야 한다.
const MAX_ACCOUNTS = 3;

const SUCCESS_MESSAGE: Record<string, string> = {
  created: '계좌를 추가했어요.',
  updated: '수정했어요.',
  deleted: '삭제했어요.',
};

const ERROR_MESSAGE: Record<string, string> = {
  validation: '은행명·계좌번호·예금주를 모두 입력해주세요.',
  'max-reached': '계좌는 최대 3개까지 등록할 수 있어요.',
  failed: '처리 중 문제가 발생했어요.',
};

export default async function AdminBankAccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const search = await searchParams;
  const accounts = await getBankAccounts();

  const message = Object.keys(SUCCESS_MESSAGE).find((key) => search[key]);
  const errorMessage = search.error && ERROR_MESSAGE[search.error];

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div>
        <h1 className="text-[20px] font-semibold text-n-9">계좌정보 관리</h1>
        <p className="mt-1 text-[12.5px] text-n-6">
          무통장입금 안내에 노출되는 계좌예요. 최대 {MAX_ACCOUNTS}개까지 등록할 수 있어요 ({accounts.length}/{MAX_ACCOUNTS}).
        </p>
      </div>

      {message && (
        <div className="rounded-md border border-success bg-success/10 px-3.5 py-3 text-[13px] font-medium text-success">
          {SUCCESS_MESSAGE[message]}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          {errorMessage}
        </div>
      )}

      {accounts.length === 0 ? (
        <p className="text-[13px] text-n-6">등록된 계좌가 없어요.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {accounts.map((account) => (
            <li key={account.id} className="rounded-lg border border-n-3 bg-n-0 p-4">
              <form action={updateBankAccount.bind(null, account.id)} className="grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-1 text-[12px] text-n-7">
                  은행명
                  <input
                    name="bankName"
                    defaultValue={account.bankName}
                    className="h-9 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-n-7">
                  계좌번호
                  <input
                    name="accountNumber"
                    defaultValue={account.accountNumber}
                    pattern="[0-9-]{4,}"
                    title="숫자와 하이픈(-)만, 4자 이상"
                    className="h-9 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-n-7">
                  예금주
                  <input
                    name="accountHolder"
                    defaultValue={account.accountHolder}
                    className="h-9 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
                  />
                </label>
                <div className="col-span-3 mt-1 flex justify-end gap-1.5">
                  <button type="submit" className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7">
                    저장
                  </button>
                  <ConfirmDialog
                    triggerLabel="삭제"
                    triggerClassName="rounded-pill border border-danger px-2.5 py-1 text-[11.5px] text-danger"
                    title="계좌를 삭제할까요?"
                    description="삭제하면 신청 확인 화면에 더 이상 노출되지 않아요."
                    confirmLabel="삭제"
                    tone="danger"
                    action={deleteBankAccount.bind(null, account.id)}
                  />
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}

      {accounts.length < MAX_ACCOUNTS && (
        <form action={createBankAccount} className="flex flex-col gap-2 rounded-lg border border-n-3 bg-n-1 p-3">
          <p className="text-[12.5px] font-medium text-n-7">계좌 추가</p>
          <div className="grid grid-cols-3 gap-2">
            <input name="bankName" placeholder="은행명" className="h-9 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]" />
            <input
              name="accountNumber"
              placeholder="계좌번호"
              pattern="[0-9-]{4,}"
              title="숫자와 하이픈(-)만, 4자 이상"
              className="h-9 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]"
            />
            <input
              name="accountHolder"
              placeholder="예금주"
              className="h-9 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]"
            />
          </div>
          <button
            type="submit"
            className="mt-1 self-end rounded-pill bg-pink px-4 py-1.5 text-[12.5px] font-semibold text-white"
          >
            추가
          </button>
        </form>
      )}
    </div>
  );
}
