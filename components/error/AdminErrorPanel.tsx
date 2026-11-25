'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import CopyButton from '@/components/ui/CopyButton';
import { AlertIcon, RefreshIcon } from './icons';
import ErrorTitle from './ErrorTitle';
import { bumpCount, REPEATED_AT, retryKey } from './retry-count';
import { useRetryCount } from './useRetryCount';
import { ADMIN_PRIMARY_BTN, ADMIN_SECONDARY_BTN, ADMIN_TEXT_LINK } from './styles';

const KST = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatKst(d: Date): string {
  const p = Object.fromEntries(KST.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}

// 관리자용 렌더링 예외 화면 (E-500-A). 운영자가 "어디서 났는지"를 복사해 개발 담당에게 전달하는 것이 목적이라
// 경로·시각·문의번호(digest, 서버 로그 대조용)를 항상 보여 준다. 스택은 노출하지 않고, 오류 메시지는 개발 환경에서만 보인다.
// 발생 시각은 error 객체마다 한 번만 정한다. 서버 렌더는 "-", 하이드레이션 뒤에 실제 시각(KST)으로 바뀐다.
const occurredAtByError = new WeakMap<object, string>();
const noopSubscribe = () => () => {};
function occurredAtFor(error: object): string {
  let t = occurredAtByError.get(error);
  if (!t) {
    t = formatKst(new Date());
    occurredAtByError.set(error, t);
  }
  return t;
}

export default function AdminErrorPanel({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const pathname = usePathname() ?? '/admin';
  const key = retryKey(pathname);
  const retries = useRetryCount(key);
  const repeated = retries >= REPEATED_AT;
  const [pendingFor, setPendingFor] = useState<Error | null>(null);
  const pending = pendingFor === error;
  const occurredAt = useSyncExternalStore(noopSubscribe, () => occurredAtFor(error), () => '-');
  const [copyStatus, setCopyStatus] = useState('');

  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = error.digest ?? '없음';
  const copyText = `경로: ${pathname}\n시각: ${occurredAt}\n문의번호: ${digest}`;

  return (
    <section aria-labelledby="error-title" className="max-w-[720px] rounded-lg border border-n-3 bg-n-0 p-6 shadow-sm">
      <title>문제가 생겼어요 | 바라 평생교육원</title>
      <div className="flex items-start gap-4">
        <AlertIcon className="mt-1 size-6 shrink-0 text-n-6" />
        <div>
          <ErrorTitle className="text-xl font-bold text-n-9 outline-none">이 화면에서 오류가 발생했어요</ErrorTitle>
          <p className="mt-2 text-[15px] leading-[1.7] text-n-7" aria-live="polite">
            {repeated
              ? '같은 오류가 반복돼요. 위 정보를 개발 담당에게 전달해 주세요.'
              : '일시적일 수 있어요. 다시 시도해도 같으면 아래 정보를 개발 담당에게 전달해 주세요.'}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-[96px_1fr] gap-x-4 gap-y-2 rounded-md bg-n-1 p-4 text-sm leading-[1.6]">
        <dt className="text-n-6">발생 경로</dt>
        <dd className="break-all font-mono text-n-8">{pathname}</dd>
        <dt className="text-n-6">발생 시각</dt>
        <dd className="font-mono text-n-8">{occurredAt}</dd>
        <dt className="text-n-6">문의번호</dt>
        <dd className="select-all break-all font-mono text-n-8">{digest}</dd>
        {process.env.NODE_ENV === 'development' && (
          <>
            <dt className="text-n-6">오류 메시지</dt>
            <dd className="break-all font-mono text-n-8">{error.message}</dd>
          </>
        )}
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-disabled={pending}
          aria-busy={pending}
          className={ADMIN_PRIMARY_BTN}
          onClick={() => {
            if (pending) return;
            setPendingFor(error);
            bumpCount(key);
            unstable_retry();
          }}
        >
          <RefreshIcon className={`size-5 ${pending ? 'animate-spin motion-reduce:animate-none' : ''}`} />
          {pending ? '불러오는 중...' : '다시 시도'}
        </button>
        <a href="/admin" className={ADMIN_SECONDARY_BTN}>
          관리자 홈으로
        </a>
        <CopyButton
          value={copyText}
          size="lg"
          label="오류 정보 복사"
          copiedLabel="복사했어요"
          failedLabel="복사하지 못했어요"
          resetMs={2000}
          onResult={(r) => setCopyStatus(r === 'copied' ? '오류 정보를 복사했어요' : '복사하지 못했어요. 직접 선택해 주세요')}
        />
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 전체 새로고침이 목적인 일반 앵커 */}
        <a href="/" className={ADMIN_TEXT_LINK}>
          사이트 홈
        </a>
      </div>
      {/* 처음부터 DOM에 있어야 스크린리더가 변화를 읽는다 */}
      <span className="sr-only" aria-live="polite">
        {copyStatus}
      </span>
    </section>
  );
}
