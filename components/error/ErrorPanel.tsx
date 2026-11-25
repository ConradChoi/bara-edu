'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AlertIcon, InfoIcon, RefreshIcon } from './icons';
import ErrorTitle from './ErrorTitle';
import PhoneButton from './PhoneButton';
import { bumpCount, REPEATED_AT, retryKey } from './retry-count';
import { useRetryCount } from './useRetryCount';
import { ACTIONS_CLASS, DESC_CLASS, PRIMARY_BTN, ROOT_CLASS, SECONDARY_BTN } from './styles';

// 신청·제출 화면에서 터진 오류는 저장 여부를 먼저 확인하게 한다(정의서 C-11) — 중복 신청/제출 방지.
const SUBMIT_PATH = /^\/(courses\/[^/]+\/apply|learn\/[^/]+\/exam)(\/|$)/;

type Props = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

// 사용자용 렌더링 예외 화면 (E-500-U, E-500-R). 문의번호(digest)는 사용자 화면에 보이지 않는다(대표 결정 2026-11-25) —
// 상담원이 로그를 찾는 용도는 관리자 화면(AdminErrorPanel)에서만 쓴다.
export default function ErrorPanel({ error, unstable_retry }: Props) {
  const pathname = usePathname() ?? '/';
  const key = retryKey(pathname);
  const retries = useRetryCount(key);
  // 다시 시도했는데 같은 화면으로 돌아오면 새 error 객체가 오므로 pending이 저절로 풀린다(effect 안 setState 없이).
  const [pendingFor, setPendingFor] = useState<Error | null>(null);
  const pending = pendingFor === error;
  const repeated = retries >= REPEATED_AT;

  useEffect(() => {
    console.error(error);
  }, [error]);

  const retry = () => {
    if (pending) return;
    setPendingFor(error);
    bumpCount(key);
    unstable_retry();
  };

  const retryButton = (primary: boolean) => (
    <button
      type="button"
      onClick={retry}
      aria-disabled={pending}
      aria-busy={pending}
      className={primary ? PRIMARY_BTN : SECONDARY_BTN}
    >
      <RefreshIcon className={`size-5 ${pending ? 'animate-spin motion-reduce:animate-none' : ''}`} />
      {pending ? '불러오는 중...' : '다시 시도하기'}
    </button>
  );
  const homeButton = (primary: boolean) => (
    // 일반 앵커: 클라이언트 라우터 상태가 손상됐을 수 있어 전체 새로고침으로 이동한다.
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a href="/" className={primary ? PRIMARY_BTN : SECONDARY_BTN}>
      홈으로 가기
    </a>
  );

  return (
    <section aria-labelledby="error-title" className={ROOT_CLASS}>
      <title>문제가 생겼어요 | 바라 평생교육원</title>
      <div className="flex size-16 items-center justify-center rounded-pill bg-n-1 text-indigo md:size-20">
        <AlertIcon className="size-8 md:size-10" />
      </div>
      <ErrorTitle>화면을 불러오지 못했어요</ErrorTitle>
      <p className={DESC_CLASS} aria-live="polite">
        {repeated
          ? '같은 문제가 반복돼요. 전화로 알려 주시면 도와 드릴게요.'
          : '잠시 후 다시 해 보세요. 계속되면 전화로 알려 주세요. 불편을 드려 죄송해요.'}
      </p>
      {SUBMIT_PATH.test(pathname) && (
        <p className="mt-4 flex w-full items-start gap-2 rounded-md bg-n-1 px-4 py-3 text-left text-base leading-[1.6] text-n-8">
          <InfoIcon className="mt-0.5 size-5 shrink-0 text-indigo" />
          <span>
            방금 하던 신청(또는 제출)이 저장됐는지{' '}
            <Link href="/my" className="inline-flex min-h-11 items-center font-semibold text-indigo underline underline-offset-2">
              내 강좌
            </Link>
            에서 먼저 확인해 주세요.
          </span>
        </p>
      )}
      <div className={ACTIONS_CLASS}>
        {/* 3회째부터는 맨 위가 "홈으로 가기"로 바뀌고 전화가 강조된다(D-3.3). 같은 자리를 반복해 눌러 같은 실패를 되풀이하지 않게 한다. */}
        {repeated ? homeButton(true) : retryButton(true)}
        {repeated ? retryButton(false) : homeButton(false)}
        <PhoneButton emphasized={repeated} />
      </div>
    </section>
  );
}
