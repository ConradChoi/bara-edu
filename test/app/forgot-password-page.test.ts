import { beforeEach, expect, test, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ForgotPasswordState } from '@/app/actions/auth';

// ---- 비밀번호 찾기 화면(/forgot-password): 상태별 화면, 열거 방지, 접근성 속성 ----
const requestReset = vi.fn();
vi.mock('@/lib/db/auth', () => ({ requestReset: (...a: unknown[]) => requestReset(...a) }));
let cookie: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (k: string) => (k === 'bara_session' && cookie ? { value: cookie } : undefined) }),
  headers: async () => ({ get: () => null }),
}));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));

// 서버 렌더에서는 useActionState가 늘 초기 상태라, 응답 이후 화면은 상태를 바꿔 끼워서 확인한다.
let actionState: ForgotPasswordState = undefined;
let pending = false;
vi.mock('react', async (orig) => {
  const actual = await orig<typeof import('react')>();
  return { ...actual, default: actual, useActionState: (_a: unknown, init: unknown) => [actionState ?? init, vi.fn(), pending] };
});

import ForgotPasswordPage, { metadata } from '@/app/(auth)/forgot-password/page';
import { siteConfig } from '@/data/site-config';

const html = async () => renderToStaticMarkup((await ForgotPasswordPage()) as ReactElement);
const telLinks = (h: string) => h.split(`href="tel:${siteConfig.phone.replace(/[^0-9]/g, '')}"`).length - 1;

beforeEach(() => {
  actionState = undefined;
  pending = false;
  cookie = undefined;
  requestReset.mockReset();
});

test('입력 화면: 제목·안내·라벨·도움말·주 버튼·로그인 링크·전화 안내(카피 FP-*)', async () => {
  const h = await html();
  expect(h).toContain('비밀번호 찾기');
  expect(h).toContain('가입한 이메일 주소를 입력해 주세요. 비밀번호를 새로 정하는 링크를 보내 드려요.');
  expect(h).toContain('<label for="forgot-email"');
  expect(h).toContain('가입한 이메일</label>');
  expect(h).toContain('휴대폰 본인인증이나 이름·연락처는 묻지 않아요. 가입한 이메일만 있으면 돼요.');
  expect(h).toContain('재설정 메일 받기');
  expect(h).toContain('href="/sign-in"');
  expect(h).toContain('이메일 주소가 기억나지 않거나 메일함을 열 수 없다면 전화로 문의해 주세요.');
  expect(h).toContain(siteConfig.phone);
  expect(h).toContain(`운영시간 ${siteConfig.supportHours}`);
  expect(telLinks(h)).toBe(1);
  expect(requestReset).not.toHaveBeenCalled();
});

test('이메일 칸: type=email·inputMode·autocomplete=email·autocapitalize·spellcheck·254자·필수, 미리 채움·자동 포커스 없음', async () => {
  const h = await html();
  const input = h.match(/<input[^>]*id="forgot-email"[^>]*>/)![0];
  expect(input).toContain('type="email"');
  expect(input).toContain('inputMode="email"');
  expect(input).toContain('autoComplete="email"');
  expect(input).toContain('autoCapitalize="none"');
  expect(input).toContain('spellCheck="false"');
  expect(input).toContain('maxLength="254"');
  expect(input).toContain('required');
  expect(input).toContain('value=""');
  expect(input).toContain('aria-describedby="forgot-email-hint"');
  expect(input).not.toContain('aria-invalid');
  expect(h).not.toContain('autofocus');
  expect(h).not.toContain('noValidate');
});

test('색인 제외 메타, 로그인 상태면 마이페이지 안내 한 줄', async () => {
  expect(metadata.robots).toMatchObject({ index: false, follow: false });
  expect(await html()).not.toContain('href="/my"');
  cookie = 'tok';
  const h = await html();
  expect(h).toContain('href="/my"');
  expect(h).toContain('에서 바꿀 수 있어요.');
});

test('제출 중: 버튼이 "보내는 중이에요"로 바뀌고 비활성·aria-busy', async () => {
  pending = true;
  const h = await html();
  expect(h).toContain('보내는 중이에요');
  expect(h).toMatch(/<button type="submit" disabled="" aria-busy="true"/);
});

test.each([
  ['empty', '이메일을 입력해 주세요'],
  ['format', '올바른 이메일 형식이 아니에요. 예: name@example.com'],
] as const)('칸 오류 %s: 칸 아래 안내(role=alert), aria-invalid·aria-describedby, 입력 유지', async (error, text) => {
  actionState = { error, email: 'a@b', resend: false };
  const h = await html();
  expect(h).toContain(text);
  expect(h).toContain('id="forgot-email-error" role="alert"');
  const input = h.match(/<input[^>]*id="forgot-email"[^>]*>/)![0];
  expect(input).toContain('aria-invalid="true"');
  expect(input).toContain('aria-describedby="forgot-email-hint forgot-email-error"');
  expect(input).toContain('value="a@b"');
});

test('429·연결 불가·기타 실패: 칸 위 알림(role=alert)에 상태별 문구, 입력한 이메일 유지, 연결 문제면 전화 버튼', async () => {
  actionState = { error: 'rate_limited', email: 'a@b.kr', resend: false };
  let h = await html();
  expect(h).toContain('요청이 많아요. 잠시 후 다시 시도해 주세요. 입력한 이메일은 그대로예요.');
  expect(h).toContain('value="a@b.kr"');
  expect(h.indexOf('role="alert"')).toBeLessThan(h.indexOf('id="forgot-email"'));
  expect(telLinks(h)).toBe(1);

  actionState = { error: 'unavailable', email: 'a@b.kr', resend: false };
  h = await html();
  expect(h).toContain('지금 연결이 원활하지 않아요. 입력한 이메일은 그대로예요. 잠시 후 다시 눌러 주세요.');
  expect(telLinks(h)).toBe(2);

  actionState = { error: 'failed', email: 'a@b.kr', resend: false };
  h = await html();
  expect(h).toContain(`메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요. 계속 안 되면 전화로 문의해 주세요. 전화 ${siteConfig.phone}`);
  expect(telLinks(h)).toBe(2);
  expect(h).toContain('재설정 메일 받기');
});

test('보냄 화면: 제목(포커스 대상)·조건 본문·안 올 때·다시 받기(윤곽선, 같은 액션)·다른 이메일·로그인 링크', async () => {
  actionState = { requested: true, email: 'a@b.kr', resend: false };
  const h = await html();
  expect(h).toContain('id="forgot-sent-title" tabindex="-1"');
  expect(h).toContain('메일함을 확인해 주세요');
  expect(h).toContain('a@b.kr</span>로 안내를 보냈어요. 가입한 이메일이 맞다면 몇 분 안에 비밀번호를 새로 정하는 링크가 도착해요. 링크는 1시간 동안 쓸 수 있어요.');
  expect(h).toContain('본인이 요청하지 않았다면 따로 하실 일은 없어요.');
  expect(h).toContain('메일이 오지 않나요?');
  expect(h).toContain('몇 분이 지나도 없다면 스팸메일함을 확인해 주세요.');
  expect(h).toContain('위에 적힌 이메일 주소가 맞는지 확인해 주세요.');
  expect(h).toContain('그래도 없으면 전화로 문의해 주세요.');
  expect(h).toContain('<input type="hidden" name="email" value="a@b.kr"/>');
  expect(h).toContain('<input type="hidden" name="resend" value="1"/>');
  expect(h).toContain('메일 다시 받기');
  expect(h).toContain('1분 뒤에 다시 받을 수 있어요. 여러 번 눌러도 메일이 빨리 오지 않아요.');
  expect(h).toContain('aria-describedby="resend-hint"');
  expect(h).toContain('id="resend-status" aria-live="polite"');
  expect(h).toContain('다른 이메일로 다시 입력하기');
  expect(h).toContain('href="/forgot-password"');
  expect(h).toContain('href="/sign-in"');
  expect(telLinks(h)).toBe(1);
  // 이 화면에는 채운 버튼이 없다(P-1.3). JS 없이 그린 첫 화면은 카운트가 없어 버튼이 활성이다(서버 한도가 막는다).
  expect(h).not.toContain('bg-indigo text-white');
  expect(h).not.toContain('aria-disabled="true"');
  expect(h).not.toContain('id="forgot-email"');
});

test('열거 방지: 보냄 화면은 입력한 이메일만 빼면 글자 하나까지 같다', async () => {
  actionState = { requested: true, email: 'member@b.kr', resend: false };
  const a = (await html()).replaceAll('member@b.kr', 'EMAIL');
  actionState = { requested: true, email: 'nobody@x.kr', resend: false };
  const b = (await html()).replaceAll('nobody@x.kr', 'EMAIL');
  expect(a).toBe(b);
});

test('다시 받기 성공: 보냄 화면을 유지하고 상태 줄에 "다시 요청했어요"(다시 보냈어요는 쓰지 않는다)', async () => {
  actionState = { requested: true, email: 'a@b.kr', resend: true };
  const h = await html();
  expect(h).toContain('메일함을 확인해 주세요');
  expect(h).toContain('다시 요청했어요. 몇 분 안에 오지 않으면 스팸메일함을 확인해 주세요.');
  expect(h).not.toContain('다시 보냈어요');
});

test('다시 받기 실패(429): 보냄 화면을 유지하고 알림만 띄운다', async () => {
  actionState = { error: 'rate_limited', email: 'a@b.kr', resend: true };
  const h = await html();
  expect(h).toContain('메일함을 확인해 주세요');
  expect(h).toContain('role="alert"');
  expect(h).toContain('요청이 많아요. 잠시 후 다시 시도해 주세요.');
  expect(h).toContain('<input type="hidden" name="email" value="a@b.kr"/>');
});
