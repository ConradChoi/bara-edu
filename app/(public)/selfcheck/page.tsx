import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: '도형심리 역량진단 | 바라 평생교육원' };

// F-DIAG-1 진단 랜딩. (public) 레이아웃이 AppHeader/Footer를 자동 적용한다.
export default function DiagnosisLandingPage() {
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center gap-4 px-6 py-16 text-center">
      <h1 className="text-[24px] font-semibold text-n-9">도형심리 역량진단</h1>
      <p className="text-[14px] text-n-6">나에게 맞는 과정은 어디부터일까요?</p>
      <span className="rounded-pill bg-info/10 px-3 py-1.5 text-[12.5px] font-medium text-info">약 5분 · 30문항</span>
      <p className="max-w-[340px] text-[12.5px] leading-relaxed text-n-6">
        6개 영역 30문항으로 지금 나에게 맞는 과정을 확인해보세요.
        <br />
        임상적 진단이 아니며 자격을 자동으로 판정하지 않습니다.
      </p>
      <Link
        href="/selfcheck/start"
        className="mt-2 h-11 w-full max-w-[280px] rounded-pill bg-pink text-center text-[14px] font-semibold leading-[44px] text-white"
      >
        진단 시작하기
      </Link>
    </div>
  );
}
