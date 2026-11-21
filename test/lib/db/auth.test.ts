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
  expect(await auth.login('a@b.kr', 'pw')).toEqual({ ok: false, reason: 'failed' });
  expect(store.set).not.toHaveBeenCalled();
});

test('login email_not_confirmed → pendingConfirmation 상태', async () => {
  fetchMock.mockResolvedValue(apiError(401, 'unauthenticated', 'email_not_confirmed'));
  expect(await actions.login(undefined, form({ email: 'a@b.kr', password: 'pw' }))).toEqual({
    pendingConfirmation: true,
    email: 'a@b.kr',
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
    error: '잠시 후 다시 시도해주세요',
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

test('signup: already_registered 문구, pending_confirmation 상태, origin 전달', async () => {
  const fields = { name: '홍길동', email: 'a@b.kr', password: 'password1', phone: '010', agreeTerms: 'on', agreePrivacy: 'on' };
  fetchMock.mockResolvedValueOnce(json(200, { status: 'already_registered' }));
  expect(await actions.signup(undefined, form(fields))).toEqual({ error: '이미 가입된 이메일이에요. 로그인해 주세요' });
  expect(lastCall().url).toBe('http://api.local/v1/auth/signup');
  expect(lastCall().body).toEqual({
    email: 'a@b.kr',
    password: 'password1',
    name: '홍길동',
    phone: '010',
    origin: 'https://bara-edu.kr',
  });
  fetchMock.mockResolvedValueOnce(json(200, { status: 'pending_confirmation' }));
  expect(await actions.signup(undefined, form(fields))).toEqual({ pendingConfirmation: true, email: 'a@b.kr' });
  fetchMock.mockResolvedValueOnce(apiError(429, 'rate_limited', '...'));
  expect(await actions.signup(undefined, form(fields))).toEqual({
    error: '가입 중 문제가 발생했어요. 잠시 후 다시 시도해주세요',
  });
});

test('resendConfirmation: 성공·실패', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { status: 'pending_confirmation' }));
  expect(await actions.resendConfirmation(undefined, form({ email: 'a@b.kr' }))).toEqual({
    pendingConfirmation: true,
    email: 'a@b.kr',
  });
  expect(lastCall().body).toEqual({ email: 'a@b.kr', origin: 'https://bara-edu.kr' });
  fetchMock.mockResolvedValueOnce(apiError(400, 'validation', '...'));
  expect(await actions.resendConfirmation(undefined, form({ email: 'a@b.kr' }))).toEqual({
    error: '인증 메일을 다시 보내지 못했어요. 잠시 후 다시 시도해주세요',
  });
});

test('verifyEmail 성공 → 쿠키 쓰기, 실패 → 쿠키 안 씀', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { sessionToken: 'tok', expiresAt: '2026-12-21T00:00:00.000Z' }));
  expect(await auth.verifyEmail('abc')).toBe(true);
  expect(lastCall().body).toEqual({ token: 'abc' });
  expect(store.set).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValueOnce(apiError(400, 'validation', 'invalid_token'));
  expect(await auth.verifyEmail('abc')).toBe(false);
  expect(store.set).toHaveBeenCalledTimes(1);
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
    error: '비밀번호 변경에 실패했어요. 링크가 만료됐을 수 있어요. 다시 요청해주세요.',
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
  fetchMock.mockResolvedValueOnce(apiError(500, 'internal', '...'));
  await expect(changePasswordAction(form(fields))).rejects.toThrow('REDIRECT:/my?settingsError=failed');
});
