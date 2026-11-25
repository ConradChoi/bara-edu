'use client';

import { useSyncExternalStore } from 'react';
import { readCount } from './retry-count';

const subscribe = () => () => {};

// 서버/하이드레이션 첫 렌더는 0, 이후 sessionStorage 값. (effect + setState 없이 읽는다)
export function useRetryCount(key: string): number {
  return useSyncExternalStore(
    subscribe,
    () => readCount(key),
    () => 0,
  );
}
