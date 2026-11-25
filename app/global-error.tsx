'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { siteConfig } from '@/data/site-config';

// E-GLB: 루트 레이아웃 자체가 실패했을 때의 마지막 안전망(app/error.tsx가 던진 예외도 여기로 온다).
// 루트 레이아웃을 대체하므로 자체 <html>/<body>가 필수이고, 실패 원인이 스타일/폰트일 수 있어
// Tailwind·globals.css·CSS 변수·Pretendard CDN·next/link·컴포넌트 import를 전혀 쓰지 않는다 — 전부 인라인 style.
// (siteConfig는 React·환경에 의존하지 않는 순수 데이터라 import한다. 번호·운영시간을 여기에 복제하지 않기 위해서다.)
// hover 스타일은 인라인으로 못 쓰므로 없다. :focus-visible만 <style> 1개로 지정한다.
// 문의번호(digest)는 사용자 화면에 보이지 않는다(대표 결정 2026-11-25).

const RETRY_KEY = 'bara:global-error-retries';
const TTL_MS = 5 * 60 * 1000;
const REPEATED_AT = 2;

function readRetries(): number {
  try {
    const e = JSON.parse(window.sessionStorage.getItem(RETRY_KEY) ?? 'null') as { n?: number; at?: number } | null;
    if (!e || typeof e.n !== 'number' || typeof e.at !== 'number' || Date.now() - e.at > TTL_MS) return 0;
    return e.n;
  } catch {
    return 0; // sessionStorage가 막힌 환경은 항상 처음 상태(버튼 3개)로 보인다
  }
}
const noopSubscribe = () => () => {};
function bumpRetries(): void {
  try {
    window.sessionStorage.setItem(RETRY_KEY, JSON.stringify({ n: readRetries() + 1, at: Date.now() }));
  } catch {
    // 무시
  }
}

const C = { indigo: '#3C1E87', ink: '#17171C', body: '#4A4A58', muted: '#6B6B7C', surface: '#F7F7F9', line: '#DCDCE3', white: '#FFFFFF' };

const BODY: CSSProperties = {
  margin: 0,
  minHeight: '100vh',
  background: C.white,
  color: C.ink,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
  WebkitTextSizeAdjust: '100%',
};
const MAIN: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  boxSizing: 'border-box',
  width: '100%',
  maxWidth: 560,
  margin: '0 auto',
  padding: '32px 20px 48px',
  textAlign: 'center',
};
const BTN: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 56,
  padding: '0 24px',
  borderRadius: 999,
  fontFamily: 'inherit',
  fontSize: 18,
  fontWeight: 700,
  cursor: 'pointer',
  textDecoration: 'none',
};
const FILLED: CSSProperties = { ...BTN, border: 0, background: C.indigo, color: C.white };
const OUTLINED: CSSProperties = { ...BTN, border: `2px solid ${C.indigo}`, background: C.white, color: C.indigo };

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry?: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [pendingFor, setPendingFor] = useState<Error | null>(null);
  const pending = pendingFor === error;
  const retries = useSyncExternalStore(noopSubscribe, readRetries, () => 0);
  const repeated = retries >= REPEATED_AT;
  const digitsOnlyPhone = siteConfig.phone.replace(/[^0-9]/g, '');

  useEffect(() => {
    console.error(error);
    titleRef.current?.focus();
  }, [error]);

  const retry = () => {
    if (pending) return;
    setPendingFor(error);
    bumpRetries();
    // 이 버전의 재시도 함수는 unstable_retry다. 없으면(다른 버전) 전체 새로고침으로 대신한다.
    if (typeof unstable_retry === 'function') unstable_retry();
    else window.location.reload();
  };

  const retryButton = (primary: boolean) => (
    <button
      key="retry"
      type="button"
      onClick={retry}
      aria-disabled={pending}
      aria-busy={pending}
      style={{ ...(primary ? FILLED : OUTLINED), opacity: pending ? 0.8 : 1 }}
    >
      {pending ? '불러오는 중...' : '다시 시도하기'}
    </button>
  );
  // 일반 앵커: 클라이언트 라우터 상태가 손상됐을 수 있으므로 전체 새로고침으로 이동한다.
  const homeLink = (primary: boolean) => (
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a key="home" href="/" style={primary ? FILLED : OUTLINED}>
      홈으로 가기
    </a>
  );

  return (
    <html lang="ko" style={{ colorScheme: 'light' }}>
      <head>
        <title>문제가 생겼어요 | 바라 평생교육원</title>
        <meta name="robots" content="noindex" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{':focus-visible{outline:3px solid #3C1E87;outline-offset:2px}'}</style>
      </head>
      <body style={BODY}>
        <main id="main" style={MAIN}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.indigo, marginBottom: 32 }}>{siteConfig.name}</div>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: C.surface,
              color: C.indigo,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width={32}
              height={32}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </div>
          <h1
            id="error-title"
            ref={titleRef}
            tabIndex={-1}
            style={{
              margin: '20px 0 0',
              fontSize: 'clamp(24px, 4vw + 12px, 32px)',
              fontWeight: 700,
              lineHeight: 1.35,
              color: C.ink,
              wordBreak: 'keep-all',
              outline: 'none',
            }}
          >
            지금은 화면을 열 수 없어요
          </h1>
          <p aria-live="polite" style={{ margin: '12px 0 0', fontSize: 18, lineHeight: 1.7, color: C.body, wordBreak: 'keep-all' }}>
            {repeated
              ? '같은 문제가 반복돼요. 전화로 알려 주시면 도와 드릴게요.'
              : '잠시 후 다시 열어 주세요. 계속 안 되면 전화로 알려 주세요.'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 420, marginTop: 32 }}>
            {/* 3번째부터는 "다시 시도하기"를 숨기고 홈이 주 버튼이 된다(같은 실패를 되풀이하지 않게). 저장소가 막힌 환경은 항상 처음 상태다. */}
            {repeated ? [homeLink(true)] : [retryButton(true), homeLink(false)]}
            <a
              href={`tel:${digitsOnlyPhone}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                boxSizing: 'border-box',
                width: '100%',
                minHeight: 72,
                padding: '8px 24px',
                border: repeated ? `2px solid ${C.indigo}` : `1px solid ${C.line}`,
                borderRadius: 999,
                background: repeated ? C.white : C.surface,
                color: C.ink,
                textDecoration: 'none',
              }}
            >
              <span style={{ fontSize: 18, fontWeight: 600 }}>전화로 문의하기</span>
              <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.02em' }}>{siteConfig.phone}</span>
            </a>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: C.muted }}>{siteConfig.supportHours}</p>
          </div>
        </main>
      </body>
    </html>
  );
}
