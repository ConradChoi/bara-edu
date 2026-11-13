'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { defaultNoticeConfig, type NoticeConfig } from '@/data/notice-config';

export type NoticeModalProps = Partial<NoticeConfig>;

/**
 * 메인 홈 화면 진입 시 노출되는 공지 팝업 모달
 * - 웹 표준 native <dialog> 요소를 활용하여 최상위 레이어(Top layer)와 접근성(포커스 트랩, ESC 닫기)을 지원합니다.
 * - '오늘 하루 보지 않기' 클릭 시 24시간 동안 localStorage에 만료 시간을 기록하여 재노출을 방지합니다.
 * - 팝업 내용 및 노출 여부는 data/notice-config.ts에서 쉽게 수정할 수 있으며, props로 오버라이드할 수도 있습니다.
 */
export default function NoticeModal(props: NoticeModalProps) {
  const config = { ...defaultNoticeConfig, ...props };
  const { id, enabled, endsAt, badge, title, content, link } = config;

  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!enabled) return;
    if (endsAt) {
      // 형식 오류(NaN)면 영구 노출되지 않도록 숨긴다 — 팝업이 안 뜨는 쪽이 바로 눈에 띈다.
      const end = Date.parse(endsAt);
      if (Number.isNaN(end) || Date.now() >= end) return;
    }
    // RecoveryRedirect가 다른 페이지로 보내는 해시와 같은 조건 — 곧 이동하므로 띄우지 않는다.
    if (/type=recovery|type=signup|error=/.test(window.location.hash)) return;

    const storageKey = `bara_notice_${id}_dismissed_until`;
    try {
      const dismissedUntil = localStorage.getItem(storageKey);
      if (dismissedUntil && Date.now() < Number(dismissedUntil)) {
        return;
      }
    } catch {
      // 로컬 스토리지 접근 불가 환경 예외 처리
    }

    // dialog가 이미 열려있지 않은 경우에만 showModal 호출 (Strict Mode 이중 실행 방지)
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, [id, enabled, endsAt]);

  if (!enabled) {
    return null;
  }

  const handleClose = () => {
    dialogRef.current?.close();
  };

  const handleDismiss24h = () => {
    const storageKey = `bara_notice_${id}_dismissed_until`;
    try {
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem(storageKey, expiresAt.toString());
    } catch {
      // 로컬 스토리지 저장 불가 환경 예외 처리
    }
    dialogRef.current?.close();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    // 배경(backdrop) 클릭 시 닫기
    if (e.target === dialogRef.current) {
      handleClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      aria-labelledby="notice-dialog-title"
      aria-describedby="notice-dialog-desc"
      className="fixed inset-0 m-auto w-[calc(100%-32px)] max-w-[420px] overflow-y-auto rounded-2xl border border-n-3 bg-white p-0 shadow-lg backdrop:bg-n-9/50 backdrop:backdrop-blur-[2px] outline-none"
    >
      <div className="flex flex-col">
        {/* 상단 헤더: 배지 & 닫기(X) 버튼 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          {badge ? (
            <span className="inline-flex items-center rounded-pill bg-pink/10 px-2.5 py-1 text-[11.5px] font-semibold text-pink">
              {badge}
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={handleClose}
            aria-label="닫기"
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-n-5 transition-colors hover:bg-n-2 hover:text-n-9 cursor-pointer"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 콘텐츠 */}
        <div className="px-6 pb-5 pt-1">
          <h2
            id="notice-dialog-title"
            className="text-[18px] font-bold text-n-9 leading-snug sm:text-[19px]"
          >
            {title}
          </h2>
          <div
            id="notice-dialog-desc"
            className="mt-3 text-[15px] text-n-7 leading-relaxed whitespace-pre-line"
          >
            {content}
          </div>

          {/* 선택적 바로가기 CTA 버튼 */}
          {link && (
            <div className="mt-5">
              {link.isExternal ? (
                <a
                  href={link.href}
                  onClick={handleClose}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-[46px] w-full items-center justify-center rounded-pill bg-pink text-[15px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                >
                  {link.text}
                </a>
              ) : (
                <Link
                  href={link.href}
                  onClick={handleClose}
                  className="flex h-[46px] w-full items-center justify-center rounded-pill bg-pink text-[15px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                >
                  {link.text}
                </Link>
              )}
            </div>
          )}
        </div>

        {/* 하단 바: '오늘 하루 보지 않기' + '닫기' */}
        <div className="flex items-center justify-between border-t border-n-2 bg-n-1 px-4 py-1.5">
          <button
            type="button"
            onClick={handleDismiss24h}
            className="min-h-[44px] px-1 text-[14px] font-medium text-n-6 transition-colors hover:text-n-9 cursor-pointer"
          >
            오늘 하루 보지 않기
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] min-w-[64px] rounded-pill border border-n-3 bg-white px-4 text-[14px] font-medium text-n-7 transition-colors hover:bg-n-2 cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </dialog>
  );
}

