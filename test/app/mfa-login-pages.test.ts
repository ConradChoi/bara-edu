import { beforeEach, expect, test, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MfaLoginState, SetupView } from '@/lib/mfa-setup-types';

// ---- M1 /sign-in/otp, M2 /sign-in/recovery, M3 /sign-in/otp-setup 화면(디자인 스펙 T-1~T-5, T-8, 카피 MFA-*) ----
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined), set: vi.fn(), delete: vi.fn() }),
  headers: async () => ({ get: () => null }),
}));
vi.mock('@/lib/db/service-key', () => ({ getServiceKey: async () => 'secret-key' }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock('server-only', () => ({}));

let actionState: unknown = undefined;
vi.mock('react', async (orig) => {
  const actual = await orig<typeof import('react')>();
  return { ...actual, default: actual, useActionState: (_a: unknown, init: unknown) => [actionState ?? init, vi.fn(), false] };
});

import OtpPage from '@/app/(auth)/sign-in/otp/page';
import RecoveryPage from '@/app/(auth)/sign-in/recovery/page';
import OtpSetupPage from '@/app/(auth)/sign-in/otp-setup/page';
import { MFA_COPY as C } from '@/lib/mfa-copy';

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let routes: Record<string, Response> = {};
const ENROLLMENT = {
  enrollmentId: 'enr-1',
  otpauthUri: 'otpauth://totp/x:a%40b.kr?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=x&digits=6&period=30&algorithm=SHA1',
  secretBase32: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  expiresAt: '2026-11-26T05:20:00.000Z',
  entry: 'B',
};
const esc = (t: string) => t.replace(/'/g, '&#x27;');
// id로 <input …/> 태그 하나를 꺼낸다(속성 순서와 무관하게 검사)
const inputTag = (h: string, id: string) => h.match(new RegExp(`<input id="${id}"[^>]*/>`))?.[0] ?? '';
const hasAttrs = (tag: string, attrs: string[]) => attrs.every((a) => tag.includes(a));

beforeEach(() => {
  jar.clear();
  routes = {};
  actionState = undefined;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => routes[new URL(url).pathname]?.clone() ?? json(404, { error: { code: 'not_found', message: 'x' } }));
  vi.stubGlobal('fetch', fetchMock);
  process.env.BARA_API_URL = 'http://api.local';
});

const render = async (page: (p: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>, params: Record<string, string> = {}) =>
  renderToStaticMarkup(await page({ searchParams: Promise.resolve(params) }));

test('M1 기본: 칸 하나(type=text, numeric, one-time-code, maxLength 7), 보이는 라벨·도움말, autofocus 없음, redirect는 hidden·복구 코드 링크로 이어진다', async () => {
  jar.set('bara_mfa', 'chal');
  const h = await render(OtpPage, { redirect: '/admin/members' });
  expect(h).toContain(`<h1 id="otp-title" tabindex="-1"`);
  expect(h).toContain(esc(C['MFA-LOGIN-TITLE']));
  expect(h).toContain(esc(`${C['MFA-LOGIN-DESC']} ${C['MFA-LOGIN-TIME']}`));
  expect(h).toMatch(/<label for="otp-code"[^>]*>6자리 번호<\/label>/);
  expect(hasAttrs(inputTag(h, 'otp-code'), ['name="code"', 'type="text"', 'inputMode="numeric"', 'autoComplete="one-time-code"', 'maxLength="7"', 'pattern="[0-9 ]*"'])).toBe(true);
  expect(h).toContain('aria-describedby="otp-desc otp-code-hint"');
  expect(h).not.toMatch(/autofocus/i);
  expect(h).toContain('<input type="hidden" name="redirect" value="/admin/members"/>');
  expect(h).toContain('href="/sign-in/recovery?redirect=%2Fadmin%2Fmembers"');
  expect(h).toContain(C['MFA-LOGIN-LINK-RESTART']);
  expect(h).not.toContain('<details open');
  // 대기표 값은 화면 어디에도 없다
  expect(h).not.toContain('chal');
});

test('M1: 대기표 쿠키가 없으면 리다이렉트 대신 "로그인 시간이 지났어요" 상태 화면 + [다시 로그인하기]', async () => {
  const h = await render(OtpPage);
  expect(h).toContain(C['MFA-LOGIN-ERR-EXPIRED-TITLE']);
  expect(h).toContain(C['MFA-LOGIN-ERR-EXPIRED']);
  expect(h).toMatch(/href="\/sign-in"[^>]*>다시 로그인하기/);
  expect(h).not.toContain('name="code"');
});

test('M1 상태별: 틀림(남은 횟수)·재사용·형식은 칸 아래 role=alert + aria-invalid, 틀림·재사용이면 도움말 펼침', async () => {
  jar.set('bara_mfa', 'chal');
  actionState = { kind: 'field', error: 'wrong', attemptsLeft: 3 } satisfies MfaLoginState;
  let h = await render(OtpPage);
  expect(h).toContain('번호가 맞지 않아요. 앱에 지금 보이는 번호를 입력해 주세요. (3번 더 시도할 수 있어요)');
  expect(h).toMatch(/<p id="otp-code-error" role="alert"/);
  expect(h).toContain('aria-invalid="true"');
  expect(h).toContain('aria-describedby="otp-desc otp-code-hint otp-code-error"');
  expect(h).toContain('<details open=""');
  actionState = { kind: 'field', error: 'used' } satisfies MfaLoginState;
  h = await render(OtpPage);
  expect(h).toContain(C['MFA-LOGIN-ERR-USED']);
  expect(h).not.toContain('번 더 시도할 수 있어요');
  actionState = { kind: 'field', error: 'format' } satisfies MfaLoginState;
  h = await render(OtpPage);
  expect(h).toContain(C['MFA-LOGIN-ERR-FORMAT']);
  expect(h).not.toContain('<details open');
});

test('M1 알림(429·503·기타)은 폼 위 role=alert, 폼은 그대로', async () => {
  jar.set('bara_mfa', 'chal');
  for (const [notice, text] of [['rate_limited', C['MFA-LOGIN-ERR-RATE']], ['unavailable', C['MFA-LOGIN-ERR-UNAVAILABLE']], ['failed', C['MFA-LOGIN-ERR-OTHER']]] as const) {
    actionState = { kind: 'notice', notice } satisfies MfaLoginState;
    const h = await render(OtpPage);
    expect(h).toContain(text);
    expect(h.indexOf('role="alert"')).toBeLessThan(h.indexOf('name="code"'));
  }
});

test('M1 상태 화면: 잠김(15분 {m}분·24시간)은 채운 버튼 없이 [로그인 화면으로]·[비밀번호 새로 정하기], 5회·계정 변경', async () => {
  jar.set('bara_mfa', 'chal');
  actionState = { kind: 'screen', screen: 'locked', lockScope: 'account', minutes: 12 } satisfies MfaLoginState;
  let h = await render(OtpPage);
  expect(h).toContain('번호가 여러 번 맞지 않아서 잠시 막았어요. 12분 뒤에 다시 시도해 주세요.');
  expect(h).toContain(C['MFA-LOGIN-ERR-LOCKED-2']);
  expect(h).toContain('href="/forgot-password"');
  expect(h).not.toContain('bg-indigo text-white');
  expect(h).not.toContain('name="code"');
  actionState = { kind: 'screen', screen: 'locked', lockScope: 'daily', minutes: 1440 } satisfies MfaLoginState;
  h = await render(OtpPage);
  expect(h).toContain(C['MFA-LOGIN-ERR-LOCKED-DAILY']);
  actionState = { kind: 'screen', screen: 'exhausted' } satisfies MfaLoginState;
  h = await render(OtpPage);
  expect(h).toContain(C['MFA-LOGIN-ERR-EXHAUSTED']);
  actionState = { kind: 'screen', screen: 'demoted' } satisfies MfaLoginState;
  h = await render(OtpPage);
  expect(h).toContain(C['MFA-LOGIN-ERR-DEMOTED']);
});

test('M2: 복구 코드 칸(autocomplete=off, 대문자, 맞춤법 끔), 앱 번호로 돌아가기, 복구 코드도 없을 때 안내, 틀림은 남은 횟수', async () => {
  jar.set('bara_mfa', 'chal');
  let h = await render(RecoveryPage, { redirect: '/admin' });
  expect(hasAttrs(inputTag(h, 'recovery-code'), ['name="recoveryCode"', 'autoComplete="off"', 'autoCapitalize="characters"', 'spellCheck="false"'])).toBe(true);
  expect(h).toContain('href="/sign-in/otp?redirect=%2Fadmin"');
  expect(h).toContain(C['MFA-REC-NONE-3']);
  actionState = { kind: 'field', error: 'wrong', attemptsLeft: 2 } satisfies MfaLoginState;
  h = await render(RecoveryPage);
  expect(h).toContain('코드가 맞지 않아요. 이미 쓴 코드인지 확인해 주세요. (2번 더 시도할 수 있어요)');
});

test('M3: 등록 대기가 있으면(새로고침) 같은 QR — SVG role=img + alt 문구, 설정 키 4글자 묶음, 바로 추가 링크, 진행 3/4단계', async () => {
  jar.set('bara_mfa', 'chal');
  routes['/v1/auth/mfa/enroll/current'] = json(200, ENROLLMENT);
  const h = await render(OtpSetupPage);
  expect(h).toMatch(/<svg role="img" aria-label="인증 앱 등록용 QR 코드" viewBox="0 0 \d+ \d+"/);
  expect(h).toContain('<path d="M0 0h7v1h-7z');
  expect(h).toContain('3/4단계: 인증 앱 등록');
  expect(h).toContain('<span class="sr-only">4단계 중 3단계예요. 인증 앱 등록 </span>');
  expect(h).toContain('<span>JBSW</span><span>Y3DP</span>');
  expect(h).toContain(`href="${ENROLLMENT.otpauthUri.replace(/&/g, '&amp;')}"`);
  expect(h).toContain('<input type="hidden" name="enrollmentId" value="enr-1"/>');
  expect(h).toContain(C['MFA-QR-PRIVACY']);
  expect(h).not.toContain('name="rotate"');
});

test('M3: 등록 코드 확인 전이면 앱 준비(다시 등록이면 MFA-REENROLL-*), 확인됐는데 대기가 없으면 [QR 새로 만들기]', async () => {
  jar.set('bara_mfa', 'chal');
  routes['/v1/auth/mfa/enroll/current'] = json(404, { error: { code: 'not_found', message: 'no_enrollment', ticketVerified: false } });
  let h = await render(OtpSetupPage, { reason: 'reset' });
  expect(h).toContain(C['MFA-REENROLL-TITLE']);
  expect(h).toContain('1/4단계: 앱 준비');
  expect(h).toContain('target="_blank" rel="noopener noreferrer"');
  expect(h).toContain('<input type="hidden" name="reason" value="reset"/>');
  h = await render(OtpSetupPage);
  expect(h).toContain(C['MFA-SETUP-TITLE']);
  routes['/v1/auth/mfa/enroll/current'] = json(404, { error: { code: 'not_found', message: 'no_enrollment', ticketVerified: true } });
  h = await render(OtpSetupPage);
  expect(h).toContain(C['MFA-CONFIRM-ERR-EXPIRED']);
  expect(h).toContain(C['MFA-CONFIRM-REGEN']);
  expect(h).toContain('name="intent" value="renew"');
});

test('M3: 대기표가 없으면 만료 화면, 방금 등록을 마친 세션이면(복구 코드 새로고침) 다시 볼 수 없다는 안내', async () => {
  let h = await render(OtpSetupPage);
  expect(h).toContain('로그인 시간이 지났어요.');
  jar.set('bara_session', 'sess');
  routes['/v1/auth/mfa/status'] = json(200, { mode: 'enforce', enrolled: true, recoveryCodesLeft: 10, recoveryCodesAcked: false });
  h = await render(OtpSetupPage);
  expect(h).toContain('복구 코드는 처음 한 번만 보여 드려요.');
  expect(h).toContain('href="/admin"');
});

test('M3 등록 코드 단계: 숫자 8자리 칸(autocomplete=off), 틀림은 남은 횟수', async () => {
  jar.set('bara_mfa', 'chal');
  actionState = { step: 'ticket', error: 'wrong', attemptsLeft: 4 } satisfies SetupView;
  const h = await render(OtpSetupPage);
  expect(hasAttrs(inputTag(h, 'ticket-code'), ['name="ticket"', 'inputMode="numeric"', 'autoComplete="off"', 'maxLength="9"'])).toBe(true);
  expect(h).toContain('등록 코드가 맞지 않아요. 받은 숫자를 다시 확인해 주세요. (4번 더 시도할 수 있어요)');
  expect(h).toContain('2/4단계: 등록 코드');
});

test('M3 복구 코드: 10개 띄어 읽기, 체크 required + 버튼 aria-disabled와 이유, 인쇄 안내지에 이름(이메일 없음), 파일로 받기 없음', async () => {
  jar.set('bara_mfa', 'chal');
  const codes = Array.from({ length: 10 }, (_, i) => `ABCD${i}-EFGH${i}`);
  actionState = { step: 'codes', codes, issuedOn: '2026년 11월 26일', name: '김관리', reason: 'enroll' } satisfies SetupView;
  const h = await render(OtpSetupPage, { redirect: '/admin/members' });
  expect(h).toContain('4/4단계: 복구 코드 보관');
  expect(h.match(/<li class="flex items-baseline gap-3">/g)).toHaveLength(10);
  expect(h).toContain('<span aria-hidden="true" class="font-mono text-xl tracking-wide text-n-9">ABCD0-EFGH0</span><span class="sr-only">A B C D 0, E F G H 0</span>');
  expect(hasAttrs(inputTag(h, 'rc-kept'), ['type="checkbox"', 'name="kept"', 'required=""'])).toBe(true);
  expect(h).toMatch(/<button type="submit" aria-disabled="true" aria-describedby="rc-kept-hint"/);
  expect(h).toContain(C['MFA-RC-NEXT-DISABLED']);
  expect(h).toContain('<input type="hidden" name="intent" value="ack"/>');
  expect(h).toContain('<input type="hidden" name="redirect" value="/admin/members"/>');
  expect(h).toContain('mfa-print-sheet');
  expect(h).toContain('관리자 이름: 김관리');
  expect(h).toContain('받은 날: 2026년 11월 26일');
  expect(h).not.toContain('@');
  expect(h).not.toContain('파일로');
  // 인쇄·복사는 JS가 브라우저 지원을 확인한 뒤에만(서버 렌더에는 없음)
  expect(h).not.toContain(C['MFA-RC-PRINT'] + '<');
});
