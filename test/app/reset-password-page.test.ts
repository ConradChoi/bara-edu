import { beforeEach, expect, test, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResetPasswordState } from '@/app/actions/auth';

// ---- 재설정 링크 화면(/reset-password): 토큰 없음, 정상, 오류 상태 (정의서 3장, 디자인 스펙 P-2, 카피 RP-*) ----
const resetPassword = vi.fn();
vi.mock('@/lib/db/auth', () => ({ resetPassword: (...a: unknown[]) => resetPassword(...a) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => ({ get: () => null }) }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));

let actionState: ResetPasswordState = undefined;
let pending = false;
vi.mock('react', async (orig) => {
  const actual = await orig<typeof import('react')>();
  return { ...actual, default: actual, useActionState: (_a: unknown, init: unknown) => [actionState ?? init, vi.fn(), pending] };
});

import ResetPasswordPage, { metadata } from '@/app/(auth)/reset-password/page';

const TOKEN = 'tok-SECRET-456';
const html = async (token?: string | string[]) =>
  renderToStaticMarkup((await ResetPasswordPage({ searchParams: Promise.resolve(token === undefined ? {} : { token }) })) as ReactElement);
const filledButtons = (h: string) => h.split('bg-indigo text-white').length - 1;

beforeEach(() => {
  actionState = undefined;
  pending = false;
  resetPassword.mockReset();
});

test('토큰 없음·형식 오류(배열·200자 초과): 링크 오류 화면, [재설정 메일 다시 받기]가 유일한 채운 버튼, 로그인 링크', async () => {
  for (const t of [undefined, '', ['a', 'b'], 'x'.repeat(201)]) {
    const h = await html(t);
    expect(h).toContain('이 링크는 쓸 수 없어요');
    expect(h).toContain('링크가 올바르지 않아요. 메일에서 링크를 다시 열거나, 새 메일을 받아 주세요.');
    expect(h).toMatch(/href="\/forgot-password"[^>]*>재설정 메일 다시 받기/);
    expect(h).toContain('href="/sign-in"');
    expect(h).toContain('로그인 화면으로');
    expect(filledButtons(h)).toBe(1);
    expect(h).not.toContain('type="password"');
    expect(h).not.toContain('text-danger-strong">링크가'); // 빨간 글씨 한 줄은 쓰지 않는다(P-2.1)
  }
  expect(resetPassword).not.toHaveBeenCalled();
});

test('정상: 안내 한 줄·두 칸(new-password, [보기] 공유)·주 버튼, 토큰은 hidden 한 곳뿐, GET은 API를 부르지 않는다', async () => {
  const h = await html(TOKEN);
  expect(h).toContain('비밀번호 재설정');
  expect(h).toContain('id="reset-note"');
  expect(h).toContain('새 비밀번호를 정해 주세요. 변경하면 모든 기기에서 로그아웃돼요.');
  expect(h).toContain('새 비밀번호');
  expect(h).toContain('새 비밀번호 확인');
  expect(h.split('autoComplete="new-password"').length - 1).toBe(2);
  expect(h.split('aria-controls="reset-password reset-confirm"').length - 1).toBe(2);
  expect(h.split('aria-label="비밀번호 보기"').length - 1).toBe(2);
  expect(h).toContain('>보기</button>');
  expect(h).toContain('aria-describedby="reset-password-hint reset-note"');
  expect(h).toContain('aria-describedby="reset-note"');
  expect(h).toContain('비밀번호 변경');
  expect(filledButtons(h)).toBe(1);
  expect(h.split(TOKEN).length - 1).toBe(1);
  expect(h).toContain(`type="hidden" name="token" value="${TOKEN}"`);
  expect(h).not.toContain('autocomplete="username"');
  expect(h).not.toContain('href="/forgot-password"');
  expect(h).not.toMatch(/href="https?:/); // 외부 링크 없음(Referer 대비)
  expect(resetPassword).not.toHaveBeenCalled();
});

test('메타: Referer 차단·색인 금지', () => {
  expect(metadata.referrer).toBe('no-referrer');
  expect(metadata.robots).toMatchObject({ index: false, follow: false });
});

test('제출 중: "변경하는 중이에요", 비활성·aria-busy', async () => {
  pending = true;
  const h = await html(TOKEN);
  expect(h).toContain('변경하는 중이에요');
  expect(h).toMatch(/<button type="submit" disabled="" aria-busy="true"/);
});

test('만료·사용된 링크(expired): 폼 맨 위 알림 안에 [재설정 메일 다시 받기](윤곽선), 채운 버튼은 제출 하나', async () => {
  actionState = { error: 'expired' };
  const h = await html(TOKEN);
  expect(h).toContain('role="alert"');
  expect(h).toContain('비밀번호를 바꾸지 못했어요. 링크가 만료됐거나 이미 썼을 수 있어요. 새 메일을 받아 주세요.');
  expect(h).toContain('링크는 1시간 동안, 한 번만 쓸 수 있어요.');
  expect(h).toMatch(/<a class="[^"]*border-indigo[^"]*" href="\/forgot-password">재설정 메일 다시 받기/);
  expect(filledButtons(h)).toBe(1);
  // 알림(링크)이 칸보다 먼저 — 첫 탭 대상
  expect(h.indexOf('href="/forgot-password"')).toBeLessThan(h.indexOf('id="reset-password"'));
  expect(h).toContain('비밀번호 변경');
});

test('연결 불가: 입력 유지 문구, 다시 받기 링크 없음', async () => {
  actionState = { error: 'unavailable' };
  const h = await html(TOKEN);
  expect(h).toContain('지금 연결이 원활하지 않아요. 입력한 내용은 그대로예요. 잠시 후 다시 눌러 주세요.');
  expect(h).not.toContain('href="/forgot-password"');
});

test.each([
  ['short', '비밀번호는 8자 이상이어야 해요'],
  ['long', '비밀번호는 200자 이하로 입력해 주세요'],
  ['rule', '비밀번호는 8자 이상 200자 이하로 입력해 주세요'],
] as const)('규칙 오류 %s: 새 비밀번호 칸 아래 안내, aria-invalid·describedby', async (error, text) => {
  actionState = { error };
  const h = await html(TOKEN);
  expect(h).toContain(text);
  expect(h).toContain('id="reset-password-error" role="alert"');
  expect(h).toContain('aria-describedby="reset-password-hint reset-note reset-password-error"');
});

test('불일치(서버 반환): 확인 칸 아래 RP-ERR-MISMATCH', async () => {
  actionState = { error: 'mismatch' };
  const h = await html(TOKEN);
  expect(h).toContain('비밀번호가 서로 달라요. 두 칸에 같은 비밀번호를 입력해 주세요.');
  expect(h).toContain('id="reset-confirm-note" role="alert"');
  expect(h).toContain('aria-describedby="reset-note reset-confirm-note"');
});
