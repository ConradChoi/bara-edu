import { siteConfig } from '@/data/site-config';
import { beforeEach, expect, test, vi } from 'vitest';

const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({
  cookies: async () => store,
  headers: async () => ({ get: (k: string) => (k === 'host' ? 'bara-edu.kr' : null) }),
}));
vi.mock('@/lib/db/service-key', () => ({ getServiceKey: async () => 'secret-key' }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import * as auth from '@/lib/db/auth';
import * as actions from '@/app/actions/auth';
import { changePassword as changePasswordAction } from '@/app/actions/account';

const fetchMock = vi.fn();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, code: string, message: string) => json(status, { error: { code, message } });
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined };
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.BARA_API_URL = 'http://api.local';
  store.get.mockReset();
  store.set.mockReset();
  store.delete.mockReset();
});

test('login 성공 → bara_session 쿠키(httpOnly, expires=expiresAt)', async () => {
  fetchMock.mockResolvedValue(json(200, { sessionToken: 'tok', expiresAt: '2026-12-21T00:00:00.000Z', userId: 'u1' }));
  expect(await auth.login('a@b.kr', 'pw')).toEqual({ ok: true });
  expect(lastCall().url).toBe('http://api.local/v1/auth/login');
  expect(lastCall().body).toEqual({ email: 'a@b.kr', password: 'pw' });
  expect(store.set).toHaveBeenCalledWith('bara_session', 'tok', {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    expires: new Date('2026-12-21T00:00:00.000Z'),
  });
});

test('login 실패 사유: 401 메시지별, 429, 그 외', async () => {
  fetchMock.mockResolvedValueOnce(apiError(401, 'unauthenticated', 'invalid_credentials'));
  expect(await auth.login('a@b.kr', 'pw')).toEqual({ ok: false, reason: 'invalid_credentials' });
  fetchMock.mockResolvedValueOnce(apiError(401, 'unauthenticated', 'password_reset_required'));
  expect(await auth.login('a@b.kr', 'pw')).toEqual({ ok: false, reason: 'invalid_credentials' });
  fetchMock.mockResolvedValueOnce(apiError(401, 'unauthenticated', 'email_not_confirmed'));
  expect(await auth.login('a@b.kr', 'pw')).toEqual({ ok: false, reason: 'email_not_confirmed' });
  fetchMock.mockResolvedValueOnce(apiError(429, 'rate_limited', '...'));
  expect(await auth.login('a@b.kr', 'pw')).toEqual({ ok: false, reason: 'rate_limited' });
  fetchMock.mockRejectedValueOnce(new Error('down'));
  expect(await auth.login('a@b.kr', 'pw')).toEqual({ ok: false, reason: 'unavailable' });
  fetchMock.mockResolvedValueOnce(apiError(401, 'unauthorized_service', '서비스 키가 올바르지 않습니다.'));
  expect(await auth.login('a@b.kr', 'pw')).toEqual({ ok: false, reason: 'failed' });
  expect(store.set).not.toHaveBeenCalled();
});

test('login email_not_confirmed → pendingConfirmation 상태(source: login — 메일을 새로 보낸 게 아니라 별도 문구)', async () => {
  fetchMock.mockResolvedValue(apiError(401, 'unauthenticated', 'email_not_confirmed'));
  expect(await actions.login(undefined, form({ email: 'a@b.kr', password: 'pw' }))).toEqual({
    pendingConfirmation: true,
    email: 'a@b.kr',
    source: 'login',
  });
});

test('login 액션 문구: 잘못된 비밀번호·재설정 필요·429', async () => {
  fetchMock.mockResolvedValueOnce(apiError(401, 'unauthenticated', 'invalid_credentials'));
  expect(await actions.login(undefined, form({ email: 'a@b.kr', password: 'pw' }))).toEqual({
    error: '이메일 또는 비밀번호가 올바르지 않아요',
  });
  fetchMock.mockResolvedValueOnce(apiError(401, 'unauthenticated', 'password_reset_required'));
  expect(await actions.login(undefined, form({ email: 'a@b.kr', password: 'pw' }))).toEqual({
    error: '이메일 또는 비밀번호가 올바르지 않아요',
  });
  fetchMock.mockResolvedValueOnce(apiError(429, 'rate_limited', '...'));
  expect(await actions.login(undefined, form({ email: 'a@b.kr', password: 'pw' }))).toEqual({
    error: '요청이 많아요. 잠시 후 다시 시도해 주세요',
  });
});

test('login 액션: 서비스 키 오류(401 unauthorized_service)·503은 비밀번호 오류 문구가 아니다', async () => {
  fetchMock.mockResolvedValueOnce(apiError(401, 'unauthorized_service', '서비스 키가 올바르지 않습니다.'));
  expect(await actions.login(undefined, form({ email: 'a@b.kr', password: 'pw' }))).toEqual({ error: '잠시 후 다시 시도해 주세요' });
  fetchMock.mockRejectedValueOnce(new Error('down'));
  expect(await actions.login(undefined, form({ email: 'a@b.kr', password: 'pw' }))).toEqual({
    error: '지금 연결이 원활하지 않아요. 잠시 후 다시 눌러 주세요',
  });
});

test('login 액션 성공 → 안전한 redirect만 따른다', async () => {
  const ok = () => json(200, { sessionToken: 't', expiresAt: '2026-12-21T00:00:00.000Z', userId: 'u1' });
  fetchMock.mockResolvedValueOnce(ok());
  await expect(actions.login(undefined, form({ email: 'a@b.kr', password: 'pw', redirect: '/learn/1' }))).rejects.toThrow(
    'REDIRECT:/learn/1',
  );
  fetchMock.mockResolvedValueOnce(ok());
  await expect(actions.login(undefined, form({ email: 'a@b.kr', password: 'pw', redirect: '//evil.com' }))).rejects.toThrow(
    'REDIRECT:/my',
  );
});

test('signup: 어떤 결과든 같은 pendingConfirmation 응답, origin 전달, 실패 문구', async () => {
  const fields = { name: '홍길동', email: 'a@b.kr', password: 'password1', passwordConfirm: 'password1', phone: '010', agreeTerms: 'on', agreePrivacy: 'on' };
  fetchMock.mockResolvedValueOnce(json(200, { status: 'pending_confirmation' }));
  expect(await actions.signup(undefined, form(fields))).toEqual({ pendingConfirmation: true, email: 'a@b.kr' });
  expect(lastCall().url).toBe('http://api.local/v1/auth/signup');
  expect(lastCall().body).toEqual({
    email: 'a@b.kr',
    password: 'password1',
    name: '홍길동',
    phone: '010',
    origin: 'https://bara-edu.kr',
  });
  fetchMock.mockResolvedValueOnce(apiError(429, 'rate_limited', '...'));
  expect(await actions.signup(undefined, form(fields))).toEqual({
    error: '요청이 많아요. 잠시 후 다시 시도해 주세요',
  });
});

test('signup: 앱은 already_registered 분기를 두지 않는다 (API가 알려 줘도 같은 화면)', async () => {
  const fields = { name: '홍길동', email: 'a@b.kr', password: 'password1', passwordConfirm: 'password1', agreeTerms: 'on', agreePrivacy: 'on' };
  fetchMock.mockResolvedValueOnce(json(200, { status: 'already_registered' }));
  expect(await actions.signup(undefined, form(fields))).toEqual({ pendingConfirmation: true, email: 'a@b.kr' });
});

test('resendConfirmation: 성공·실패(전화 문의 안내)', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { status: 'pending_confirmation' }));
  expect(await actions.resendConfirmation(undefined, form({ email: 'a@b.kr' }))).toEqual({
    pendingConfirmation: true,
    email: 'a@b.kr',
  });
  expect(lastCall().body).toEqual({ email: 'a@b.kr', origin: 'https://bara-edu.kr' });
  fetchMock.mockResolvedValueOnce(apiError(400, 'validation', '...'));
  expect(await actions.resendConfirmation(undefined, form({ email: 'a@b.kr' }))).toEqual({
    error: `메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요. 계속 안 되면 전화로 문의해 주세요. ${siteConfig.phone}`,
  });
});

test('checkSignupLink: GET, 토큰은 헤더로(URL에 없음), 상태를 그대로 돌려주고 쿠키·세션은 건드리지 않는다', async () => {
  const ready = { state: 'ready', email: 'a@b.kr', requestedAt: '2026-11-25T00:00:00.000Z', expiresAt: '2026-11-26T00:00:00.000Z', attemptsLeft: 5 };
  fetchMock.mockResolvedValueOnce(json(200, ready));
  expect(await auth.checkSignupLink('tok-1')).toEqual({ ok: true, link: ready });
  expect(lastCall().url).toBe('http://api.local/v1/auth/signup-link/check');
  expect(lastCall().init.method).toBe('GET');
  expect(lastCall().init.headers['x-bara-signup-token']).toBe('tok-1');
  expect(lastCall().init.body).toBeUndefined();
  expect(store.set).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(json(200, { state: 'locked' }));
  expect(await auth.checkSignupLink('tok-1')).toEqual({ ok: true, link: { state: 'locked' } });
  fetchMock.mockResolvedValueOnce(apiError(429, 'rate_limited', 'x'));
  expect(await auth.checkSignupLink('tok-1')).toEqual({ ok: false, reason: 'rate_limited' });
  fetchMock.mockRejectedValueOnce(new Error('down'));
  expect(await auth.checkSignupLink('tok-1')).toEqual({ ok: false, reason: 'unavailable' });
  expect(store.set).not.toHaveBeenCalled();
});

test('completeSignup: 성공 → 쿠키 쓰기, 비밀번호는 본문으로만', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { sessionToken: 'tok', expiresAt: '2026-12-21T00:00:00.000Z' }));
  expect(await auth.completeSignup('t1', 'pw-1234 ')).toEqual({ ok: true });
  expect(lastCall().url).toBe('http://api.local/v1/auth/signup-link/complete');
  expect(lastCall().body).toEqual({ token: 't1', password: 'pw-1234 ' });
  expect(store.set).toHaveBeenCalledTimes(1);
});

test('completeSignup: 오류를 사유별로 나누고 쿠키는 쓰지 않는다 (attemptsLeft 포함)', async () => {
  const withLeft = json(403, { error: { code: 'forbidden', message: 'wrong_password', attemptsLeft: 3 } });
  fetchMock.mockResolvedValueOnce(withLeft);
  expect(await auth.completeSignup('t', 'x')).toEqual({ ok: false, reason: 'wrong_password', attemptsLeft: 3 });
  const cases: Array<[Response, unknown]> = [
    [apiError(409, 'conflict', 'link_locked'), { ok: false, reason: 'link_locked' }],
    [apiError(409, 'conflict', 'link_expired'), { ok: false, reason: 'link_expired' }],
    [apiError(409, 'conflict', 'link_done'), { ok: false, reason: 'link_done' }],
    [apiError(400, 'validation', 'invalid_token'), { ok: false, reason: 'invalid_token' }],
    [json(400, { error: { code: 'validation', message: 'x', field: 'password' } }), { ok: false, reason: 'validation', field: 'password' }],
    [apiError(429, 'rate_limited', 'x'), { ok: false, reason: 'rate_limited' }],
    [apiError(500, 'internal', 'x'), { ok: false, reason: 'failed' }],
  ];
  for (const [res, expected] of cases) {
    fetchMock.mockResolvedValueOnce(res);
    expect(await auth.completeSignup('t', 'x')).toEqual(expected);
  }
  fetchMock.mockRejectedValueOnce(new Error('down'));
  expect(await auth.completeSignup('t', 'x')).toEqual({ ok: false, reason: 'unavailable' });
  expect(store.set).not.toHaveBeenCalled();
});

test('adminConfirmEmail: 성공, 409 password_not_set, 그 밖의 실패를 구분한다', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
  expect(await auth.adminConfirmEmail('u1')).toEqual({ ok: true });
  fetchMock.mockResolvedValueOnce(apiError(409, 'conflict', 'password_not_set'));
  expect(await auth.adminConfirmEmail('u1')).toEqual({ ok: false, reason: 'password_not_set' });
  fetchMock.mockResolvedValueOnce(apiError(404, 'not_found', 'x'));
  expect(await auth.adminConfirmEmail('u1')).toEqual({ ok: false, reason: 'failed' });
});

test('logout: 세션으로 API 호출 후 쿠키 삭제(API 실패해도 삭제)', async () => {
  store.get.mockReturnValue({ value: 'tok' });
  fetchMock.mockRejectedValueOnce(new Error('down'));
  await auth.logout();
  expect(lastCall().url).toBe('http://api.local/v1/auth/logout');
  expect(lastCall().init.headers['x-bara-session']).toBe('tok');
  expect(store.delete).toHaveBeenCalledWith('bara_session');
});

test('resetPassword: 성공 → /sign-in?reset=1, 만료 토큰 → 기존 문구, 검증 문구', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
  await expect(
    actions.resetPassword(undefined, form({ token: 't1', password: 'newpass12', confirm: 'newpass12' })),
  ).rejects.toThrow('REDIRECT:/sign-in?reset=1');
  expect(lastCall().url).toBe('http://api.local/v1/auth/reset-password');
  expect(lastCall().body).toEqual({ token: 't1', newPassword: 'newpass12' });
  fetchMock.mockResolvedValueOnce(apiError(400, 'validation', 'invalid_token'));
  expect(await actions.resetPassword(undefined, form({ token: 't1', password: 'newpass12', confirm: 'newpass12' }))).toEqual({
    error: '비밀번호 변경에 실패했어요. 링크가 만료됐을 수 있어요. 다시 요청해 주세요.',
  });
  expect(await actions.resetPassword(undefined, form({ token: 't1', password: 'short', confirm: 'short' }))).toEqual({
    error: '비밀번호는 8자 이상이어야 해요',
  });
  expect(await actions.resetPassword(undefined, form({ token: 't1', password: 'newpass12', confirm: 'other123' }))).toEqual({
    error: '비밀번호가 일치하지 않아요',
  });
});

test('마이페이지 비밀번호 변경: change-password 1회, 403 → current-password-wrong, 성공 시 쿠키 유지', async () => {
  store.get.mockReturnValue({ value: 'tok' });
  const fields = { currentPassword: 'old', newPassword: 'newpass12', confirmPassword: 'newpass12' };
  fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
  await expect(changePasswordAction(form(fields))).rejects.toThrow('REDIRECT:/my?settingsSuccess=password');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(lastCall().url).toBe('http://api.local/v1/auth/change-password');
  expect(lastCall().body).toEqual({ currentPassword: 'old', newPassword: 'newpass12' });
  expect(store.delete).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(apiError(403, 'forbidden', '...'));
  await expect(changePasswordAction(form(fields))).rejects.toThrow('REDIRECT:/my?settingsError=current-password-wrong');
  fetchMock.mockResolvedValueOnce(json(400, { error: { code: 'validation', message: 'x', field: 'password' } }));
  await expect(changePasswordAction(form(fields))).rejects.toThrow('REDIRECT:/my?settingsError=password-validation');
  fetchMock.mockResolvedValueOnce(json(400, { error: { code: 'validation', message: 'x', field: 'currentPassword' } }));
  await expect(changePasswordAction(form(fields))).rejects.toThrow('REDIRECT:/my?settingsError=current-password-wrong');
  fetchMock.mockResolvedValueOnce(json(400, { error: { code: 'validation', message: 'x' } }));
  await expect(changePasswordAction(form(fields))).rejects.toThrow('REDIRECT:/my?settingsError=failed');
  fetchMock.mockResolvedValueOnce(apiError(500, 'internal', '...'));
  await expect(changePasswordAction(form(fields))).rejects.toThrow('REDIRECT:/my?settingsError=failed');
  fetchMock.mockResolvedValueOnce(apiError(401, 'unauthorized_service', '서비스 키가 올바르지 않습니다.'));
  await expect(changePasswordAction(form(fields))).rejects.toThrow('REDIRECT:/my?settingsError=failed');
  fetchMock.mockResolvedValueOnce(apiError(401, 'unauthenticated', '로그인이 필요합니다.'));
  await expect(changePasswordAction(form(fields))).rejects.toThrow('REDIRECT:/sign-in');
  expect(store.delete).not.toHaveBeenCalled();
});

// ---- 비밀번호 찾기: requestReset (계약: password-reset-request.md 5.1) ----
const apiFieldError = (status: number, code: string, field: string) => json(status, { error: { code, message: '요청 형식이 올바르지 않습니다.', field } });

test('requestReset: POST /v1/auth/request-reset { email, origin }, 200 → { ok: true }(응답 값은 쓰지 않는다)', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { ok: true, extra: 'ignored' }));
  expect(await auth.requestReset('a@b.kr', 'https://bara-edu.kr')).toEqual({ ok: true });
  expect(lastCall().url).toBe('http://api.local/v1/auth/request-reset');
  expect(lastCall().init.method).toBe('POST');
  expect(lastCall().body).toEqual({ email: 'a@b.kr', origin: 'https://bara-edu.kr' });
  expect(lastCall().init.headers['x-bara-service-key']).toBe('secret-key');
  expect(store.set).not.toHaveBeenCalled();
  expect(store.delete).not.toHaveBeenCalled();
});

test('requestReset: 429·503·네트워크 오류·400·401·500을 구분한다', async () => {
  fetchMock.mockResolvedValueOnce(apiError(429, 'rate_limited', '요청이 너무 많습니다.'));
  expect(await auth.requestReset('a@b.kr', 'o')).toEqual({ ok: false, reason: 'rate_limited' });
  fetchMock.mockResolvedValueOnce(apiError(503, 'unavailable', 'db'));
  expect(await auth.requestReset('a@b.kr', 'o')).toEqual({ ok: false, reason: 'unavailable' });
  fetchMock.mockRejectedValueOnce(new Error('down'));
  expect(await auth.requestReset('a@b.kr', 'o')).toEqual({ ok: false, reason: 'unavailable' });
  fetchMock.mockResolvedValueOnce(apiFieldError(400, 'validation', 'email'));
  expect(await auth.requestReset('a@b.kr', 'o')).toEqual({ ok: false, reason: 'validation', field: 'email' });
  // 허용되지 않은 origin은 사용자가 고칠 칸이 아니다 → field 없음
  fetchMock.mockResolvedValueOnce(apiFieldError(400, 'validation', 'origin'));
  expect(await auth.requestReset('a@b.kr', 'o')).toEqual({ ok: false, reason: 'validation' });
  fetchMock.mockResolvedValueOnce(apiError(401, 'unauthorized_service', '서비스 키가 올바르지 않습니다.'));
  expect(await auth.requestReset('a@b.kr', 'o')).toEqual({ ok: false, reason: 'failed' });
  fetchMock.mockResolvedValueOnce(apiError(500, 'internal', 'x'));
  expect(await auth.requestReset('a@b.kr', 'o')).toEqual({ ok: false, reason: 'failed' });
});
