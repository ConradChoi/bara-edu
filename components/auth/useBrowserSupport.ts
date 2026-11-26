import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

// 브라우저 기능(클립보드·인쇄) 지원 여부. 서버 렌더·하이드레이션 전에는 null — JS가 필요한 보조 기능은 그때 숨긴다(T-10).
export function useBrowserSupport(check: () => boolean): boolean | null {
  return useSyncExternalStore(subscribe, check, () => null);
}

export const hasClipboard = () => typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText);
export const hasPrint = () => typeof window !== 'undefined' && typeof window.print === 'function';
