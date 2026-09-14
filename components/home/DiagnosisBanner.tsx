import Link from 'next/link';

// F-DIAG-2 홈 진입점(Must). 히어로 하단에 배치 — "홈→결과 3클릭 이내" 기준의 1번째 클릭.
export default function DiagnosisBanner() {
  return (
    <section className="mx-auto max-w-[1080px] px-6 py-6">
      <div className="flex flex-col items-start justify-between gap-4 rounded-2xl bg-pink/10 px-8 py-7 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[19px] font-semibold text-n-9">나는 어떤 과정부터 시작하면 좋을까요?</h2>
          <p className="text-[13px] text-n-6">30문항 · 약 5분이면 나에게 맞는 과정을 알 수 있어요</p>
        </div>
        <Link href="/selfcheck" className="h-11 shrink-0 rounded-pill bg-pink px-5 text-center text-[13px] font-semibold leading-[44px] text-white">
          무료로 진단받기 →
        </Link>
      </div>
    </section>
  );
}
