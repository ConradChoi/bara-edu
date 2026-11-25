'use client';

import { useState } from 'react';

type CopyButtonProps = {
  value: string;
  // 아래는 모두 선택값이다. 기본값은 기존 동작(작은 알약 '복사' → '복사됨', 1.5초)과 같다.
  label?: string;
  copiedLabel?: string;
  failedLabel?: string;
  size?: 'sm' | 'lg';
  resetMs?: number;
  // 복사 결과를 부모(예: 스크린리더용 aria-live 영역)에 알린다.
  onResult?: (result: 'copied' | 'failed') => void;
};

const SIZE_CLASS = {
  sm: 'rounded-pill border border-n-3 px-2 py-0.5 text-[11px] text-n-6',
  lg:
    'inline-flex min-h-12 items-center justify-center rounded-pill border border-n-3 px-5 text-[15px] font-semibold text-n-8 hover:bg-n-1 ' +
    'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-indigo',
} as const;

export default function CopyButton({
  value,
  label = '복사',
  copiedLabel = '복사됨',
  failedLabel,
  size = 'sm',
  resetMs = 1500,
  onResult,
}: CopyButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const finish = (next: 'copied' | 'failed') => {
    setStatus(next);
    onResult?.(next);
    setTimeout(() => setStatus('idle'), resetMs);
  };

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          finish('copied');
        } catch {
          // 클립보드 권한이 없는 환경. failedLabel을 준 화면만 실패를 알린다(기존 사용처는 예전처럼 조용히 무시).
          if (failedLabel) finish('failed');
        }
      }}
      className={SIZE_CLASS[size]}
    >
      {status === 'copied' ? copiedLabel : status === 'failed' ? failedLabel : label}
    </button>
  );
}
