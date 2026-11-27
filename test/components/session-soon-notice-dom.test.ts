// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import SessionSoonNotice from '@/components/admin/SessionSoonNotice';
import { MFA_COPY as C } from '@/lib/mfa-copy';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.useRealTimers());

test('MFA-SESSION-SOON: 10분 전이 되면 화면을 다시 열지 않아도 알림이 나타난다', async () => {
  vi.useFakeTimers();
  const el = document.createElement('div');
  const root = createRoot(el);
  await act(async () => root.render(createElement(SessionSoonNotice, { endsInMs: 15 * 60_000 })));
  expect(el.textContent).not.toContain(C['MFA-SESSION-SOON']);
  await act(async () => vi.advanceTimersByTime(5 * 60_000 - 30_000));
  expect(el.textContent).not.toContain(C['MFA-SESSION-SOON']);
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(el.textContent).toContain(C['MFA-SESSION-SOON']);
  expect(el.querySelector('[role="status"]')).not.toBeNull();
  await act(async () => root.unmount());
});

test('QA I-1: 절전으로 타이머가 멈췄다가 돌아오면(시계만 흐름) 창에 돌아오는 순간 알림', async () => {
  vi.useFakeTimers();
  const el = document.createElement('div');
  const root = createRoot(el);
  await act(async () => root.render(createElement(SessionSoonNotice, { endsInMs: 60 * 60_000 })));
  expect(el.textContent).not.toContain(C['MFA-SESSION-SOON']);
  // 타이머는 돌지 않고 시계만 55분 흐름(절전)
  vi.setSystemTime(Date.now() + 55 * 60_000);
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(el.textContent).toContain(C['MFA-SESSION-SOON']);
  await act(async () => root.unmount());
});
