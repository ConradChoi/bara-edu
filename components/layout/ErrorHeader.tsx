// 루트 폴백 오류 화면(404, app/error.tsx, 503) 전용 간이 헤더. 세션을 조회하지 않고 링크는 로고 하나뿐이다.
// 일반 <a>(전체 새로고침): 클라이언트 라우터 상태가 손상됐을 수 있는 화면이라 next/link를 쓰지 않는다.
export default function ErrorHeader() {
  return (
    <header className="flex h-[57px] items-center border-b border-n-3 bg-n-0 px-5 md:px-6">
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 전체 새로고침이 목적인 일반 앵커 */}
      <a
        href="/"
        className="inline-flex min-h-11 items-center text-lg font-bold text-indigo focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-indigo"
      >
        바라 평생교육원
      </a>
    </header>
  );
}
