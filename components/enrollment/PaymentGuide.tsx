import BankAccountList from '@/components/enrollment/BankAccountList';

// 무통장입금 안내 (F-PUB-6). 계좌 정보는 Admin(계좌정보 관리)에서 등록한 값을 그대로
// 보여준다 — 예전에는 환경변수(NEXT_PUBLIC_BANK_NAME 등)로 계좌 1개만 하드코딩했는데
// 실제로 설정된 적이 없어 항상 "준비 중" 문구만 노출되고 있었다(2026-08-28 교체).
export default function PaymentGuide({ paymentDueAt }: { paymentDueAt: string }) {
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

      <BankAccountList />

      <div className="flex items-center justify-between text-[13px]">
        <span className="text-n-6">입금 기한</span>
        <span className="text-n-9">{dueDate}까지</span>
      </div>
    </div>
  );
}
