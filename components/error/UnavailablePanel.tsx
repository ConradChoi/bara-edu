'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { RefreshIcon, WifiOffIcon } from './icons';
import ErrorTitle from './ErrorTitle';
import PhoneButton from './PhoneButton';
import { bumpCount, REPEATED_AT } from './retry-count';
import { useRetryCount } from './useRetryCount';
import { DESC_CLASS, PRIMARY_BTN, SECONDARY_BTN } from './styles';

const DIRECT_PATH = '/service-unavailable';
const COUNT_KEY = 'bara:unavailable-views';

// API 연결 불가 전체 화면 (E-503). proxy가 보호 경로 요청을 이 화면으로 rewrite한다 — 주소창은 원래 주소(/my 등)라
// 새로고침 한 번이 곧 재시도다. API·세션·DB를 부르지 않는다(장애 중에 또 장애 나는 것을 막는다).
// 반복 실패는 "다시 시도하기"를 누른 횟수로 센다(경로 무관 키 1개, 5분 안). 자동 재시도/폴링은 하지 않는다.
export default function UnavailablePanel() {
  const pathname = usePathname() ?? DIRECT_PATH;
  const direct = pathname === DIRECT_PATH;
  const retries = useRetryCount(COUNT_KEY);
  const [pending, setPending] = useState(false);
  const repeated = retries >= REPEATED_AT; // 두 번 눌러도 안 되면(이 화면을 3번째 보면) 전화 안내를 강조

  const retry = () => {
    if (pending) return;
    setPending(true);
    bumpCount(COUNT_KEY);
    // 직접 연 경우는 되돌아갈 원래 주소가 없으니 홈으로, rewrite로 들어온 경우는 같은 주소를 다시 요청한다.
    if (direct) window.location.assign('/');
    else window.location.reload();
  };

  const retryButton = (
    <button type="button" onClick={retry} aria-disabled={pending} aria-busy={pending} className={PRIMARY_BTN}>
      <RefreshIcon className={`size-5 ${pending ? 'animate-spin motion-reduce:animate-none' : ''}`} />
      {pending ? '불러오는 중...' : '다시 시도하기'}
    </button>
  );
  const homeButton = (
    // eslint-disable-next-line @next/next/no-html-link-for-pages -- 전체 새로고침이 목적인 일반 앵커
    <a href="/" className={SECONDARY_BTN}>
      홈으로 가기
    </a>
  );
  const phone = <PhoneButton emphasized={repeated} />;

  return (
    <section
      aria-labelledby="error-title"
      className="mx-auto flex w-full max-w-[560px] flex-col items-center px-5 py-6 text-center md:px-6 md:py-20"
    >
      {/* 낮은 화면에서는 장식 배지를 숨겨 전화 버튼이 첫 화면에 들어오게 한다 */}
      <div className="flex size-14 items-center justify-center rounded-pill bg-n-1 text-indigo md:size-20 [@media(max-height:700px)]:hidden">
        <WifiOffIcon className="size-7 md:size-10" />
      </div>
      <ErrorTitle>지금 연결이 원활하지 않아요</ErrorTitle>
      <p className={DESC_CLASS} aria-live="polite">
        {repeated ? '연결이 계속 안 돼요. 전화로 알려 주세요.' : '잠깐 문제가 생겼어요. 1~2분 뒤에 다시 눌러 보세요.'}
      </p>
      {!repeated && !direct && <p className="mt-2 text-base text-n-6">다시 시도하면 하던 곳으로 돌아가요</p>}
      <div className="mt-8 flex w-full flex-col gap-3 md:mt-10 md:max-w-[420px]">
        {/* 연결 복구는 새로고침이 유일한 해결책이라 반복돼도 "다시 시도하기"가 주 버튼이다. 전화를 두 번째로 올리고 강조한다. */}
        {retryButton}
        {repeated ? phone : homeButton}
        {repeated ? homeButton : phone}
      </div>
    </section>
  );
}
