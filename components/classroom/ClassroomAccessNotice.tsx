import Link from 'next/link';

// F-LRN-6 / flows.md §2.3 원문: "입금 확인 후 이용 가능해요"
export default function ClassroomAccessNotice({ reason }: { reason: 'not-enrolled' | 'not-approved' }) {
  const message = reason === 'not-approved' ? '입금 확인 후 이용 가능해요' : '수강 신청 후 이용할 수 있어요';

  return (
    <div className="mx-auto flex max-w-[360px] flex-col items-center gap-4 px-6 py-20 text-center">
      <p className="text-[15px] font-semibold text-n-9">{message}</p>
      <Link href="/my" className="rounded-pill bg-pink px-5 py-2.5 text-[13px] font-semibold text-white">
        마이페이지로 이동
      </Link>
    </div>
  );
}
