import CopyButton from '@/components/ui/CopyButton';

// 무통장입금 안내 (F-PUB-6). 계좌 정보는 실제 운영 계좌를 코드에 하드코딩하지 않고
// 환경변수로 주입한다 — 미설정 시 잘못된 계좌 안내를 보여주는 대신 문의 안내로 대체한다.
export default function PaymentGuide({ paymentDueAt }: { paymentDueAt: string }) {
  const bankName = process.env.NEXT_PUBLIC_BANK_NAME;
  const accountNumber = process.env.NEXT_PUBLIC_BANK_ACCOUNT_NUMBER;
  const hasBankInfo = Boolean(bankName && accountNumber);

  const dueDate = new Date(paymentDueAt).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-n-3 bg-n-1 p-5">
      <span className="w-fit rounded-pill bg-warning/15 px-2.5 py-1 text-[11px] font-semibold text-warning">
        입금 대기 중
      </span>

      {hasBankInfo ? (
        <>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-n-6">입금 계좌</span>
            <span className="flex items-center gap-2 font-medium text-n-9">
              {bankName} {accountNumber}
              <CopyButton value={accountNumber!} />
            </span>
          </div>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-n-6">입금자명</span>
            <span className="text-n-9">본인 이름으로 입금해주세요</span>
          </div>
        </>
      ) : (
        <p className="text-[13px] text-n-7">계좌 정보를 준비 중이에요. 고객센터로 문의해 주세요.</p>
      )}

      <div className="flex items-center justify-between text-[13px]">
        <span className="text-n-6">입금 기한</span>
        <span className="text-n-9">{dueDate}까지</span>
      </div>
    </div>
  );
}
