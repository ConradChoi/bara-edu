import { beforeEach, expect, test, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthFormState } from '@/app/actions/auth';

// ---- 로그인·가입 화면의 비밀번호 찾기 진입점과 재설정 성공 배너 (정의서 9.3, 디자인 스펙 P-3, 카피 EP-*·RP-SUCCESS) ----
vi.mock('@/lib/db/auth', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => ({ get: () => null }) }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));

let actionState: AuthFormState = undefined;
vi.mock('react', async (orig) => {
  const actual = await orig<typeof import('react')>();
  return { ...actual, default: actual, useActionState: (_a: unknown, init: unknown) => [actionState ?? init, vi.fn(), false] };
});

import SignInPage from '@/app/(auth)/sign-in/page';
import SignUpPage from '@/app/(auth)/sign-up/page';

const signIn = async (params: { redirect?: string; reset?: string; ended?: string } = {}) =>
  renderToStaticMarkup((await SignInPage({ searchParams: Promise.resolve(params) })) as ReactElement);
const signUp = async () => renderToStaticMarkup((await SignUpPage({ searchParams: Promise.resolve({}) })) as ReactElement);

beforeEach(() => {
  actionState = undefined;
});

test('로그인: 비밀번호 칸 바로 아래 [비밀번호를 잊으셨나요?] → /forgot-password(이메일을 URL에 싣지 않는다), 로그인 버튼 위', async () => {
  const h = await signIn();
  expect(h).toMatch(/<a class="[^"]*min-h-11[^"]*" href="\/forgot-password">비밀번호를 잊으셨나요\?<\/a>/);
  const pw = h.indexOf('name="password"');
  const link = h.indexOf('href="/forgot-password"');
  expect(pw).toBeGreaterThan(0);
  expect(link).toBeGreaterThan(pw);
  expect(link).toBeLessThan(h.indexOf('type="submit"'));
  expect(h).not.toContain('forgot-password?');
});

test('로그인 실패 알림이 있어도 링크는 칸과 버튼 사이에 그대로', async () => {
  actionState = { error: '이메일 또는 비밀번호가 올바르지 않아요' };
  const h = await signIn();
  const link = h.indexOf('href="/forgot-password"');
  expect(link).toBeGreaterThan(h.indexOf('name="password"'));
  expect(link).toBeLessThan(h.indexOf('이메일 또는 비밀번호가 올바르지 않아요'));
});

test('가입 폼에는 비밀번호 찾기 링크가 없다', async () => {
  expect(await signUp()).not.toContain('href="/forgot-password"');
});

test('재설정 성공 배너(?reset=1): RP-SUCCESS 문구, 큰 글씨·n-9/n-8', async () => {
  const h = await signIn({ reset: '1' });
  expect(h).toContain('role="status"');
  expect(h).toContain('비밀번호가 변경됐어요.');
  expect(h).toContain('새 비밀번호로 로그인해 주세요. 다른 기기에서는 다시 로그인해야 해요.');
  expect(h).not.toContain('text-success-strong">비밀번호가');
  expect(await signIn()).not.toContain('비밀번호가 변경됐어요');
});

test('인증 대기(source=login): 재설정 안내와 [비밀번호 새로 정하기]가 메일 다시 받기보다 위', async () => {
  actionState = { pendingConfirmation: true, email: 'a@b.kr', source: 'login' };
  const h = await signIn();
  expect(h).toContain('가입할 때 정한 비밀번호가 기억나지 않나요? 비밀번호를 새로 정하면 가입도 함께 끝나요.');
  expect(h).toMatch(/href="\/forgot-password">비밀번호 새로 정하기<\/a>/);
  // 재전송 영역(구분선 블록)보다 위. 안쪽 재전송 폼도 같은 목 상태를 받으므로 구분선으로 위치를 잰다.
  expect(h.indexOf('href="/forgot-password"')).toBeLessThan(h.indexOf('border-t border-n-3 pt-4'));
  expect(h).not.toContain('forgot-password?');
});

test('가입 직후 안내(source 없음): 보조 [비밀번호 찾기] 링크, 가입 여부를 암시하는 말(이미·다시 정하기·가입도 함께) 없음', async () => {
  actionState = { pendingConfirmation: true, email: 'a@b.kr' };
  const h = await signUp();
  expect(h).toMatch(/비밀번호가 기억나지 않으면 <a class="[^"]*" href="\/forgot-password">비밀번호 찾기<\/a>를 눌러 주세요\./);
  expect(h.indexOf('border-t border-n-3 pt-4')).toBeLessThan(h.indexOf('href="/forgot-password"'));
  expect(h).not.toContain('가입도 함께 끝나요');
  expect(h).not.toContain('비밀번호 새로 정하기');
});

test('자동 로그아웃 이유(?ended=max|idle, 기획서 4.9): MFA-SESSION-MAX/IDLE + 관리자 경로면 WHY + NOTE, 기존 배너 대신', async () => {
  const max = await signIn({ redirect: '/admin/members', ended: 'max' });
  expect(max).toContain('role="status"');
  expect(max).toContain('로그인한 지 12시간이 지나서 로그아웃했어요. 다시 로그인해 주세요.');
  expect(max).toContain('관리자 계정은 개인정보를 지키려고 로그인 시간을 짧게 두었어요.');
  expect(max).toContain('다시 로그인하면 하던 화면으로 돌아와요. 입력하던 내용은 저장되지 않았을 수 있어요.');
  expect(max).not.toContain('세션이 만료되었어요');
  const idle = await signIn({ redirect: '/my', ended: 'idle' });
  expect(idle).toContain('1시간 동안 사용하지 않아서 로그아웃했어요. 다시 로그인해 주세요.');
  expect(idle).not.toContain('관리자 계정은 개인정보를');
  // 모르는 값은 무시하고 기존 배너 그대로, redirect만 있으면 기존 배너
  for (const p of [{ redirect: '/admin', ended: 'evil' }, { redirect: '/admin' }]) {
    const h = await signIn(p);
    expect(h).toContain('세션이 만료되었어요');
    expect(h).not.toContain('로그아웃했어요');
  }
});
