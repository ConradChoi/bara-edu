import CopyButton from '@/components/ui/CopyButton';
import { getBankAccounts } from '@/lib/supabase/queries';

// 입금 계좌 안내 — Admin에서 등록한 계좌(최대 3개)를 그대로 보여준다. 신청 확인 화면과
// 입금 대기 안내(PaymentGuide) 양쪽에서 재사용한다.
export default async function BankAccountList() {
  const accounts = await getBankAccounts();

  if (accounts.length === 0) {
    return <p className="text-[13px] text-n-7">계좌 정보를 준비 중이에요. 고객센터로 문의해 주세요.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {accounts.map((account) => (
        <div key={account.id} className="flex items-center justify-between text-[13px]">
          <span className="text-n-6">{account.bankName}</span>
          <span className="flex items-center gap-2 font-medium text-n-9">
            {account.accountNumber} ({account.accountHolder})
            <CopyButton value={account.accountNumber} />
          </span>
        </div>
      ))}
      <p className="text-[12px] text-n-6">위 계좌 중 하나를 골라 본인 이름으로 입금해주세요.</p>
    </div>
  );
}
