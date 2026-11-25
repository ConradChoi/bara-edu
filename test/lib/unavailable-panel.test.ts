import { afterEach, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { getClientSnapshot, getServerSnapshot, isDirectPath } from '@/components/error/useIsDirectVisit';
import UnavailablePanel from '@/components/error/UnavailablePanel';

afterEach(() => vi.unstubAllGlobals());

test('isDirectPath: /service-unavailable만 직접 방문, 그 밖(rewrite로 열린 원래 주소)은 아니다', () => {
  expect(isDirectPath('/service-unavailable')).toBe(true);
  expect(isDirectPath('/my')).toBe(false);
  expect(isDirectPath('/learn/abc')).toBe(false);
});

test('하이드레이션 첫 렌더 값(서버 스냅샷)은 브라우저 주소와 무관하게 true, 하이드레이션 뒤에만 실제 주소를 따른다', () => {
  vi.stubGlobal('window', { location: { pathname: '/my' } });
  expect(getServerSnapshot()).toBe(true);
  expect(getClientSnapshot()).toBe(false);
  vi.stubGlobal('window', { location: { pathname: '/service-unavailable' } });
  expect(getClientSnapshot()).toBe(true);
});

test('서버 HTML(정적)은 직접 방문 모양 — 주소에 의존하는 "하던 곳으로 돌아가요" 문단이 없다', () => {
  const html = renderToString(createElement(UnavailablePanel));
  expect(html).not.toContain('하던 곳으로 돌아가요');
  expect(html).toContain('홈으로 가기');
});
