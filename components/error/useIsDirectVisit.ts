'use client';

import { useSyncExternalStore } from 'react';

export const DIRECT_PATH = '/service-unavailable';

export const isDirectPath = (pathname: string): boolean => pathname === DIRECT_PATH;

const subscribe = () => () => {};
export const getClientSnapshot = (): boolean => isDirectPath(window.location.pathname);
// 서버 렌더와 하이드레이션 첫 렌더는 항상 true다. 이 화면은 정적 prerender(/service-unavailable)라 서버 HTML은 직접 방문 모양이고,
// proxy가 보호 경로(/my 등)를 rewrite해 열어도 브라우저 주소만 다르다. 주소 의존 부분을 하이드레이션 뒤에 바꿔 불일치 오류를 막는다.
export const getServerSnapshot = (): boolean => true;

// 브라우저 주소가 /service-unavailable 자체인가 (usePathname은 서버가 모르는 주소에 의존해 하이드레이션 불일치가 났다).
export function useIsDirectVisit(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
