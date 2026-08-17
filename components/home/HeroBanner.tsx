import Link from 'next/link';

export default function HeroBanner({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <section className="w-full bg-indigo">
      <div className="mx-auto flex max-w-[880px] flex-col items-center gap-6 px-5 py-16 text-center md:gap-8 md:py-24 lg:py-28">
        <h1 className="text-[28px] font-extrabold leading-[1.25] text-n-0 md:text-[40px] lg:text-[52px]">
          배움으로 새로운 나를 창조합니다
        </h1>
        <p className="max-w-[560px] text-[16px] leading-[1.7] text-n-2 md:text-[17px] lg:text-[18px]">
          바라 평생교육원은 IT·디지털, 외국어, 자격증, 직무역량, 취미·교양 등 다양한 강좌를 온라인으로 배울 수 있는 곳입니다.
        </p>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:gap-4">
          <Link
            href="/courses"
            className="inline-flex h-[52px] w-full items-center justify-center rounded-pill bg-pink px-8 text-[18px] font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:w-auto"
          >
            강좌 둘러보기
          </Link>
          {isLoggedIn ? (
            <Link
              href="/my"
              className="inline-flex h-[52px] w-full items-center justify-center rounded-pill border-2 border-n-0/70 px-8 text-[16px] font-semibold text-n-0 hover:bg-n-0/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:w-auto"
            >
              내 강의실로 이동
            </Link>
          ) : (
            <Link
              href="/sign-up"
              className="inline-flex h-[52px] w-full items-center justify-center rounded-pill border-2 border-n-0/70 px-8 text-[16px] font-semibold text-n-0 hover:bg-n-0/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:w-auto"
            >
              회원가입
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
