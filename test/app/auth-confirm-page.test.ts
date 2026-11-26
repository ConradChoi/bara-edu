import { beforeEach, expect, test, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SignupFinishState } from '@/app/actions/auth';

// ---- 가입 마무리 페이지(GET): 상태별 화면, 읽기 전용, 토큰 노출 ----
const checkSignupLink = vi.fn();
const completeSignup = vi.fn();
vi.mock('@/lib/db/auth', () => ({
  checkSignupLink: (t: string) => checkSignupLink(t),
  completeSignup: (...a: unknown[]) => completeSignup(...a),
}));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));

// 서버 렌더에서는 useActionState가 늘 초기 상태라, 응답 이후 화면(틀림 등)은 상태를 바꿔 끼워서 확인한다.
let actionState: SignupFinishState = undefined;
vi.mock('react', async (orig) => {
  const actual = await orig<typeof import('react')>();
  return { ...actual, default: actual, useActionState: (_a: unknown, init: unknown) => [actionState ?? init, vi.fn(), false] };
});

import ConfirmPage, { metadata } from '@/app/(auth)/auth/confirm/page';
import { siteConfig } from '@/data/site-config';

const TOKEN = 'tok-SECRET-123';
const html = async (token: string | undefined) =>
  renderToStaticMarkup((await ConfirmPage({ searchParams: Promise.resolve(token === undefined ? {} : { token }) })) as ReactElement);
const READY = { state: 'ready', email: 'a@b.kr', requestedAt: '2026-11-25T06:10:00.000Z', expiresAt: new Date(Date.now() + 20 * 3600e3).toISOString(), attemptsLeft: 5 };

beforeEach(() => {
  checkSignupLink.mockReset();
  completeSignup.mockReset();
  actionState = undefined;
});

test('ready: 제목·정보 영역·비밀번호 칸·주 버튼, 접힌 도움말(남은 5번)', async () => {
  checkSignupLink.mockResolvedValue({ ok: true, link: READY });
  const h = await html(TOKEN);
  expect(h).toContain('가입을 마무리해 주세요');
  expect(h).toContain('a@b.kr');
  expect(h).toContain('11월 25일 오후 3시 10분');
  expect(h).toMatch(/\d+시간 안에 마쳐 주세요/);
  expect(h).toContain('autoComplete="current-password"');
  expect(h).toContain('가입 완료하기');
  expect(h).toContain('비밀번호가 기억나지 않아요');
  expect(h).not.toContain('open=""');
  expect(h).not.toContain('autofocus');
  expect(h).toContain('/sign-up?email=a%40b.kr');
  expect(h).toContain(siteConfig.phone);
  expect(h).toContain(siteConfig.supportHours);
});

test('ready의 "기억나지 않아요": [비밀번호 새로 정하기](윤곽선)가 맨 위, 다시 가입하기는 텍스트 링크, 채운 버튼은 [가입 완료하기] 하나', async () => {
  checkSignupLink.mockResolvedValue({ ok: true, link: READY });
  const h = await html(TOKEN);
  const details = h.slice(h.indexOf('<details'), h.indexOf('</details>'));
  expect(details).toContain('이메일로 비밀번호를 새로 정할 수 있어요. 새로 정하면 가입도 함께 끝나요.');
  expect(details).toMatch(/<a class="[^"]*border-indigo bg-n-0[^"]*" href="\/forgot-password">비밀번호 새로 정하기<\/a>/);
  expect(details).toMatch(/다른 방법: <a class="inline-flex min-h-11[^"]*" href="\/sign-up\?email=a%40b.kr">처음부터 다시 가입하기<\/a>/);
  expect(details.indexOf('href="/forgot-password"')).toBeLessThan(details.indexOf('href="/sign-up'));
  expect(details).toContain('전화로 문의하기');
  expect(details).toContain(`운영시간 ${siteConfig.supportHours}`);
  expect(h.split('bg-indigo').length - 1).toBe(1);
});

test('GET은 읽기 전용: checkSignupLink만 부르고 확정(completeSignup)은 부르지 않는다', async () => {
  checkSignupLink.mockResolvedValue({ ok: true, link: READY });
  await html(TOKEN);
  expect(checkSignupLink).toHaveBeenCalledWith(TOKEN);
  expect(completeSignup).not.toHaveBeenCalled();
});

test('남은 횟수 2 이하로 열면 도움말이 펼쳐진다(3회째부터), 3 이상이면 접힘', async () => {
  checkSignupLink.mockResolvedValue({ ok: true, link: { ...READY, attemptsLeft: 2 } });
  expect(await html(TOKEN)).toContain('open=""');
  checkSignupLink.mockResolvedValue({ ok: true, link: { ...READY, attemptsLeft: 3 } });
  expect(await html(TOKEN)).not.toContain('open=""');
});

test.each([
  ['locked', '이 링크는 더 쓸 수 없어요'],
  ['expired', '이 링크는 쓸 수 없어요'],
  ['invalid', '이 링크는 쓸 수 없어요'],
  ['done', '이미 가입을 마쳤어요'],
])('상태 %s -> 상태 화면, 비밀번호 칸 없음', async (state, title) => {
  checkSignupLink.mockResolvedValue({ ok: true, link: { state } });
  const h = await html(TOKEN);
  expect(h).toContain(title);
  expect(h).not.toContain('type="password"');
  expect(h).not.toContain('가입 완료하기');
});

test('locked: [비밀번호 새로 정하기]가 유일한 채운 버튼, 다시 가입하기는 윤곽선으로(이메일은 모르므로 /sign-up 그대로)', async () => {
  checkSignupLink.mockResolvedValue({ ok: true, link: { state: 'locked' } });
  const h = await html(TOKEN);
  expect(h).toContain('이메일로 비밀번호를 새로 정할 수 있어요. 새로 정하면 가입도 함께 끝나요.');
  expect(h).toMatch(/<a class="[^"]*bg-indigo text-white[^"]*" href="\/forgot-password">비밀번호 새로 정하기<\/a>/);
  expect(h).toMatch(/<a class="[^"]*border-indigo bg-n-0[^"]*" href="\/sign-up">처음부터 다시 가입하기<\/a>/);
  expect(h.split('bg-indigo text-white').length - 1).toBe(1);
  expect(h.indexOf('href="/forgot-password"')).toBeLessThan(h.indexOf('href="/sign-up"'));
  expect(h).toContain('어려우면 전화로 문의해 주세요.');
  expect(h).not.toContain('처음부터 다시 가입하면 새 인증 메일을 보내 드려요.');
});

test('expired/invalid: 메일 다시 받기(채운 버튼)와 다시 가입하기, 로그인 링크, 그 사이 재설정 한 줄', async () => {
  checkSignupLink.mockResolvedValue({ ok: true, link: { state: 'expired' } });
  const h = await html(TOKEN);
  expect(h).toContain('메일 다시 받기');
  expect(h).toMatch(/비밀번호가 기억나지 않으면 <a class="[^"]*" href="\/forgot-password">비밀번호 새로 정하기<\/a>를 눌러 주세요\./);
  expect(h.indexOf('메일 다시 받기')).toBeLessThan(h.indexOf('href="/forgot-password"'));
  expect(h.indexOf('href="/forgot-password"')).toBeLessThan(h.indexOf('href="/sign-up"'));
  expect(h).toContain('처음부터 다시 가입하기');
  expect(h).toContain('href="/sign-in"');
});

test('done: 로그인하기 버튼', async () => {
  checkSignupLink.mockResolvedValue({ ok: true, link: { state: 'done' } });
  expect(await html(TOKEN)).toContain('로그인하기');
});

test('토큰이 없으면 API를 부르지 않고 invalid 화면', async () => {
  expect(await html(undefined)).toContain('이 링크는 쓸 수 없어요');
  expect(await html('x'.repeat(201))).toContain('이 링크는 쓸 수 없어요');
  expect(checkSignupLink).not.toHaveBeenCalled();
});

test('연결 오류(503·예외) -> 연결 화면과 다시 시도 링크, 429 -> 요청이 많아요', async () => {
  checkSignupLink.mockResolvedValue({ ok: false, reason: 'unavailable' });
  const h = await html('a+b');
  expect(h).toContain('지금 연결이 원활하지 않아요');
  expect(h).toContain('href="/auth/confirm?token=a%2Bb"');
  checkSignupLink.mockRejectedValue(new Error('network'));
  expect(await html(TOKEN)).toContain('지금 연결이 원활하지 않아요');
  checkSignupLink.mockResolvedValue({ ok: false, reason: 'rate_limited' });
  expect(await html(TOKEN)).toContain('요청이 많아요');
});

test('토큰 노출: Referer 차단·색인 금지 메타, 입력 hidden 한 곳 외에 HTML에 없다(상태 화면에는 없음)', async () => {
  expect(metadata.referrer).toBe('no-referrer');
  expect(metadata.robots).toMatchObject({ index: false });
  checkSignupLink.mockResolvedValue({ ok: true, link: READY });
  const h = await html(TOKEN);
  expect(h.split(TOKEN).length - 1).toBe(1);
  expect(h).toContain(`type="hidden" name="token" value="${TOKEN}"`);
  checkSignupLink.mockResolvedValue({ ok: true, link: { state: 'locked' } });
  expect(await html(TOKEN)).not.toContain(TOKEN);
});

test('틀림: 오류 박스·남은 횟수, 3회째부터 펼침, 마지막 1번, aria-invalid', async () => {
  checkSignupLink.mockResolvedValue({ ok: true, link: READY });
  actionState = { kind: 'wrong_password', attemptsLeft: 3 };
  let h = await html(TOKEN);
  expect(h).toContain('비밀번호가 맞지 않아요.');
  expect(h).toContain('3번 더 입력해 볼 수 있어요.');
  expect(h).toContain('aria-invalid="true"');
  expect(h).toContain('aria-describedby="confirm-password-hint confirm-password-error"');
  expect(h).toContain('id="confirm-password-error" role="alert"'); // Enter 제출 시 포커스 이벤트가 없어도 읽히게(2026-11-26 QA 접근성)
  expect(h).not.toContain('open=""');
  actionState = { kind: 'wrong_password', attemptsLeft: 2 };
  h = await html(TOKEN);
  expect(h).toContain('open=""');
  // 남은 2번 이하: 재설정 링크를 직접 건다(대표 결정 8, P-3)
  expect(h).toMatch(/비밀번호가 기억나지 않으면 <a class="[^"]*" href="\/forgot-password">비밀번호 새로 정하기<\/a>를 눌러 주세요\./);
  actionState = { kind: 'wrong_password', attemptsLeft: 1 };
  expect(await html(TOKEN)).toContain('마지막 1번 남았어요. 천천히 확인해 주세요.');
});

test('액션 응답으로 잠김 상태 화면으로 바뀐다(토큰은 화면에서 사라진다)', async () => {
  checkSignupLink.mockResolvedValue({ ok: true, link: READY });
  actionState = { kind: 'status', status: 'locked' };
  const h = await html(TOKEN);
  expect(h).toContain('이 링크는 더 쓸 수 없어요');
  expect(h).not.toContain(TOKEN);
});

test('연결 오류·429 알림은 입력 화면 위에(횟수 상자 없음)', async () => {
  checkSignupLink.mockResolvedValue({ ok: true, link: READY });
  actionState = { kind: 'error', error: 'unavailable' };
  let h = await html(TOKEN);
  expect(h).toContain('입력한 내용은 그대로예요');
  expect(h).toContain('role="alert"');
  expect(h).not.toContain('번 더 입력해 볼 수 있어요');
  actionState = { kind: 'error', error: 'rate_limited' };
  h = await html(TOKEN);
  expect(h).toContain('입력한 횟수에는 포함되지 않아요');
  expect(h).toContain('가입 완료하기');
});

test('빈 비밀번호 안내', async () => {
  checkSignupLink.mockResolvedValue({ ok: true, link: READY });
  actionState = { kind: 'error', error: 'empty' };
  const h = await html(TOKEN);
  expect(h).toContain('비밀번호를 입력해 주세요');
  expect(h).toContain('aria-invalid="true"');
});
