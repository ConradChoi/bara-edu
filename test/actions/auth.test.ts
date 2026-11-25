import { beforeEach, expect, test, vi } from 'vitest';
import { siteConfig } from '@/data/site-config';

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

import * as actions from '@/app/actions/auth';

const fetchMock = vi.fn();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const GOOD = { name: '홍길동', email: 'a@b.kr', password: 'password1', passwordConfirm: 'password1', agreeTerms: 'on', agreePrivacy: 'on' };
const signup = (over: Record<string, string | undefined> = {}) => {
  // 확인 칸은 따로 지정하지 않으면 비밀번호와 같은 값(일치)으로 보낸다
  const f = { ...GOOD, ...(over.password !== undefined && !('passwordConfirm' in over) ? { passwordConfirm: over.password } : {}), ...over } as Record<string, string>;
  for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  return actions.signup(undefined, form(f));
};
const sentBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.BARA_API_URL = 'http://api.local';
  store.get.mockReset();
  store.set.mockReset();
  store.delete.mockReset();
});

test('signup 검증: 이름·이메일·비밀번호·동의 — 문구가 맞고 API를 부르지 않는다', async () => {
  expect(await signup({ name: '가' })).toEqual({ error: '이름을 2자 이상 입력해 주세요' });
  expect(await signup({ name: ' 가 ' })).toEqual({ error: '이름을 2자 이상 입력해 주세요' });
  expect(await signup({ email: 'not-an-email' })).toEqual({ error: '올바른 이메일 형식이 아니에요' });
  expect(await signup({ email: 'a@b' })).toEqual({ error: '올바른 이메일 형식이 아니에요' });
  expect(await signup({ password: '1234567' })).toEqual({ error: '비밀번호는 8자 이상이어야 해요' });
  expect(await signup({ agreeTerms: undefined })).toEqual({ error: '이용약관과 개인정보 수집·이용에 모두 동의해야 가입할 수 있어요' });
  expect(await signup({ agreePrivacy: undefined })).toEqual({ error: '이용약관과 개인정보 수집·이용에 모두 동의해야 가입할 수 있어요' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('signup: 비밀번호 확인이 비었거나 다르면 서버에서도 막는다(API 호출 없음, 공백까지 그대로 비교)', async () => {
  expect(await signup({ passwordConfirm: 'password2' })).toEqual({ error: '비밀번호가 서로 달라요. 두 칸에 같은 비밀번호를 다시 입력해 주세요.' });
  expect(await signup({ passwordConfirm: 'password1 ' })).toEqual({ error: expect.stringContaining('서로 달라요') });
  expect(await signup({ passwordConfirm: undefined })).toEqual({ error: '비밀번호를 한 번 더 입력해 주세요' });
  expect(await signup({ passwordConfirm: '' })).toEqual({ error: '비밀번호를 한 번 더 입력해 주세요' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('signup: 이메일·이름·연락처의 앞뒤 공백을 지우고 연락처가 비면 null로 보낸다', async () => {
  fetchMock.mockResolvedValue(json(200, { status: 'pending_confirmation' }));
  expect(await signup({ email: '  a@b.kr ', name: ' 홍길동 ', phone: '   ' })).toEqual({ pendingConfirmation: true, email: 'a@b.kr' });
  expect(sentBody()).toMatchObject({ email: 'a@b.kr', name: '홍길동', phone: null, origin: 'https://bara-edu.kr' });
});

test('signup: 비밀번호 앞뒤 공백은 그대로 둔다(trim하지 않음)', async () => {
  fetchMock.mockResolvedValue(json(200, { status: 'pending_confirmation' }));
  await signup({ password: ' pass word1 ' });
  expect(sentBody().password).toBe(' pass word1 ');
});

test('signup: API 오류는 상태별 문구 — 429는 요청이 많음, 연결 실패는 연결 문구, 500은 일반 실패, 400은 입력 확인', async () => {
  fetchMock.mockResolvedValueOnce(json(429, { error: { code: 'rate_limited', message: 'y' } }));
  expect(await signup()).toEqual({ error: '요청이 많아요. 잠시 후 다시 시도해 주세요' });
  fetchMock.mockResolvedValueOnce(json(500, { error: { code: 'internal', message: 'y' } }));
  expect(await signup()).toEqual({ error: '가입 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요' });
  fetchMock.mockResolvedValueOnce(json(400, { error: { code: 'validation', message: 'y' } }));
  expect(await signup()).toEqual({ error: expect.stringContaining('이메일') });
  fetchMock.mockRejectedValueOnce(new Error('down'));
  expect(await signup()).toEqual({ error: '지금 연결이 원활하지 않아요. 잠시 후 다시 눌러 주세요' });
});

test('signup: API 한도(이름 100자·연락처 30자·비밀번호 200자·이메일 규칙)는 API를 부르기 전에 칸별로 안내', async () => {
  expect(await signup({ name: '가'.repeat(101) })).toEqual({ error: '이름은 100자 이하로 입력해 주세요' });
  expect(await signup({ phone: '1'.repeat(31) })).toEqual({ error: '연락처는 30자 이하로 입력해 주세요' });
  expect(await signup({ password: 'a'.repeat(201) })).toEqual({ error: '비밀번호는 200자 이하로 입력해 주세요' });
  for (const email of ['홍길동@예시.kr', 'a..b@c.kr', '.a@c.kr', 'a@c.k', `${'a'.repeat(250)}@c.kr`]) {
    expect(await signup({ email }), email).toEqual({ error: '올바른 이메일 형식이 아니에요' });
  }
  expect(fetchMock).not.toHaveBeenCalled();
  // 경계값은 통과해 API로 간다
  fetchMock.mockResolvedValueOnce(json(200, { status: 'pending_confirmation' }));
  expect(await signup({ phone: '1'.repeat(30), password: 'a'.repeat(200), name: '가'.repeat(100) })).toEqual({ pendingConfirmation: true, email: 'a@b.kr' });
});

test('resendConfirmation: 429는 요청이 많다는 문구, 그 밖의 실패는 전화 안내', async () => {
  fetchMock.mockResolvedValueOnce(json(429, { error: { code: 'rate_limited', message: 'x' } }));
  expect(await actions.resendConfirmation(undefined, form({ email: 'a@b.kr' }))).toEqual({ error: '요청이 많아요. 잠시 후 다시 시도해 주세요' });
});

test('signup: 가입 여부와 무관하게 같은 응답 객체 (이메일 열거 방지)', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { status: 'pending_confirmation' }));
  const fresh = await signup();
  fetchMock.mockResolvedValueOnce(json(200, { status: 'already_registered' }));
  expect(await signup()).toEqual(fresh);
});

test('resendConfirmation: 이메일 형식 검증은 API 호출 전, 성공은 이메일을 trim해 보낸다', async () => {
  expect(await actions.resendConfirmation(undefined, form({ email: 'nope' }))).toEqual({ error: '올바른 이메일 형식이 아니에요' });
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(json(200, { status: 'pending_confirmation' }));
  expect(await actions.resendConfirmation(undefined, form({ email: ' a@b.kr ' }))).toEqual({ pendingConfirmation: true, email: 'a@b.kr' });
  expect(sentBody()).toEqual({ email: 'a@b.kr', origin: 'https://bara-edu.kr' });
});

test('resendConfirmation: 실패 문구에 전화 문의 안내(siteConfig.phone)', async () => {
  fetchMock.mockResolvedValueOnce(json(500, { error: { code: 'internal', message: 'x' } }));
  const r = await actions.resendConfirmation(undefined, form({ email: 'a@b.kr' }));
  expect(r).toEqual({ error: expect.stringContaining(siteConfig.phone) });
});

test('login: 이메일·비밀번호 누락은 API 호출 없이 입력 문구', async () => {
  expect(await actions.login(undefined, form({ email: '', password: 'x' }))).toEqual({ error: '이메일과 비밀번호를 입력해 주세요' });
  expect(await actions.login(undefined, form({ email: 'a@b.kr', password: '' }))).toEqual({ error: '이메일과 비밀번호를 입력해 주세요' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('login: 성공 시 쿠키를 쓰고 ?redirect= 값 중 사이트 내부 경로만 따른다', async () => {
  const ok = () => json(200, { sessionToken: 't', expiresAt: '2026-12-21T00:00:00.000Z', userId: 'u1' });
  const go = async (redirect?: string) => {
    fetchMock.mockResolvedValueOnce(ok());
    const fields: Record<string, string> = { email: 'a@b.kr', password: 'pw' };
    if (redirect !== undefined) fields.redirect = redirect;
    return actions.login(undefined, form(fields)).then(() => 'none', (e: Error) => e.message);
  };
  expect(await go('/learn/c1?x=1')).toBe('REDIRECT:/learn/c1?x=1');
  expect(await go()).toBe('REDIRECT:/my');
  expect(await go('')).toBe('REDIRECT:/my');
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/a\\b', '/x://y', 'evil.com']) {
    expect(await go(bad), bad).toBe('REDIRECT:/my');
  }
  expect(store.set).toHaveBeenCalledTimes(10); // 위 10번의 성공 로그인 모두 쿠키를 썼다
});

test('login: 429는 요청이 많다는 문구, 연결 실패는 연결 문구, 한도를 넘는 입력은 API를 부르지 않는다', async () => {
  fetchMock.mockResolvedValueOnce(json(429, { error: { code: 'rate_limited', message: 'x' } }));
  expect(await actions.login(undefined, form({ email: 'a@b.kr', password: 'pw' }))).toEqual({ error: '요청이 많아요. 잠시 후 다시 시도해 주세요' });
  fetchMock.mockRejectedValueOnce(new Error('down'));
  expect(await actions.login(undefined, form({ email: 'a@b.kr', password: 'pw' }))).toEqual({ error: '지금 연결이 원활하지 않아요. 잠시 후 다시 눌러 주세요' });
  fetchMock.mockClear();
  expect(await actions.login(undefined, form({ email: 'a@b.kr', password: 'p'.repeat(201) }))).toEqual({ error: '이메일 또는 비밀번호가 올바르지 않아요' });
  expect(await actions.login(undefined, form({ email: '홍길동@예시.kr', password: 'pw' }))).toEqual({ error: '올바른 이메일 형식이 아니에요' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('login: 실패하면 쿠키를 쓰지 않는다', async () => {
  fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'unauthenticated', message: 'invalid_credentials' } }));
  await actions.login(undefined, form({ email: 'a@b.kr', password: 'pw' }));
  expect(store.set).not.toHaveBeenCalled();
});

test('logout 액션: API 호출 후 쿠키 삭제, /로 이동', async () => {
  store.get.mockReturnValue({ value: 'tok' });
  fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
  await expect(actions.logout()).rejects.toThrow('REDIRECT:/');
  expect(store.delete).toHaveBeenCalledWith('bara_session');
});

test('resetPassword 액션: 토큰이 없으면 API를 부르지 않고 만료 문구', async () => {
  expect(await actions.resetPassword(undefined, form({ password: 'newpass12', confirm: 'newpass12' }))).toEqual({
    error: '비밀번호 변경에 실패했어요. 링크가 만료됐을 수 있어요. 다시 요청해 주세요.',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

// 브라우저는 URL의 탭·개행을 지우고 \를 /로 취급하므로 "/\t/evil.com"은 "//evil.com"이 된다.
test('login: 탭·개행·제어문자·공백·역슬래시가 섞인 ?redirect= 는 /my로 막는다 (오픈 리다이렉트)', async () => {
  const bad = [
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r/evil.com',
    '/\r\n/evil.com',
    '/\u0000/evil.com',
    '/\u007f/evil.com',
    '/\u0085/evil.com',
    '/\u2028/evil.com',
    '/\u00a0/evil.com',
    '/ /evil.com',
    ' //evil.com',
    '\t//evil.com',
    '/a b',
    '/a\tb',
    '/\\evil.com',
    '/'.padEnd(3000, 'a'),
  ];
  for (const b of bad) {
    fetchMock.mockResolvedValueOnce(json(200, { sessionToken: 't', expiresAt: '2026-12-21T00:00:00.000Z', userId: 'u1' }));
    const r = await actions.login(undefined, form({ email: 'a@b.kr', password: 'pw', redirect: b })).then(() => 'none', (e: Error) => e.message);
    expect(r, JSON.stringify(b)).toBe('REDIRECT:/my');
  }
});

test('login: 정상적인 내부 경로는 그대로 따른다 (쿼리·해시·인코딩 포함)', async () => {
  for (const ok of ['/', '/my', '/learn/c1/lessons/l1?x=1&y=2', '/courses/a-b/apply#top', '/courses/%ED%95%9C%EA%B8%80']) {
    fetchMock.mockResolvedValueOnce(json(200, { sessionToken: 't', expiresAt: '2026-12-21T00:00:00.000Z', userId: 'u1' }));
    const r = await actions.login(undefined, form({ email: 'a@b.kr', password: 'pw', redirect: ok })).then(() => 'none', (e: Error) => e.message);
    expect(r, ok).toBe(`REDIRECT:${ok}`);
  }
});

// ---- API 400의 error.field로 칸별 안내 (2026-11-25)
const v400 = (field?: string) => json(400, { error: { code: 'validation', message: 'y', ...(field ? { field } : {}) } });

test('signup: API 400의 field가 있으면 그 칸의 문구', async () => {
  const cases: [string, string][] = [
    ['email', '올바른 이메일 형식이 아니에요'],
    ['password', '비밀번호는 8자 이상 200자 이하로 입력해 주세요'],
    ['name', '이름은 2자 이상 100자 이하로 입력해 주세요'],
    ['phone', '연락처는 30자 이하로 입력해 주세요'],
  ];
  for (const [field, error] of cases) {
    fetchMock.mockResolvedValueOnce(v400(field));
    expect(await signup(), field).toEqual({ error });
  }
});

test('signup: field가 없거나 모르는 칸(origin 등)이면 기존 입력 확인 문구', async () => {
  for (const field of [undefined, 'origin', 'whatever']) {
    fetchMock.mockResolvedValueOnce(v400(field));
    expect(await signup(), String(field)).toEqual({ error: expect.stringContaining('입력한 내용을 다시 확인해 주세요') });
  }
});

test('resendConfirmation: 400 + field=email → 이메일 형식 문구', async () => {
  fetchMock.mockResolvedValueOnce(v400('email'));
  expect(await actions.resendConfirmation(undefined, form({ email: 'a@b.kr' }))).toEqual({ error: '올바른 이메일 형식이 아니에요' });
});

test('login: 400 + field=email → 이메일 형식 문구, field=password → 비밀번호 오류와 같은 문구, 그 외 일반 실패', async () => {
  const run = () => actions.login(undefined, form({ email: 'a@b.kr', password: 'pw' }));
  fetchMock.mockResolvedValueOnce(v400('email'));
  expect(await run()).toEqual({ error: '올바른 이메일 형식이 아니에요' });
  fetchMock.mockResolvedValueOnce(v400('password'));
  expect(await run()).toEqual({ error: '이메일 또는 비밀번호가 올바르지 않아요' });
  fetchMock.mockResolvedValueOnce(v400());
  expect(await run()).toEqual({ error: '잠시 후 다시 시도해 주세요' });
});

test('resetPassword: 400 + field=password → 비밀번호 한도 문구, 토큰 문제는 만료 문구', async () => {
  const run = () => actions.resetPassword(undefined, form({ token: 't1', password: 'newpass12', confirm: 'newpass12' }));
  fetchMock.mockResolvedValueOnce(v400('password'));
  expect(await run()).toEqual({ error: '비밀번호는 8자 이상 200자 이하로 입력해 주세요' });
  fetchMock.mockResolvedValueOnce(json(400, { error: { code: 'validation', message: 'invalid_token' } }));
  expect(await run()).toEqual({ error: '비밀번호 변경에 실패했어요. 링크가 만료됐을 수 있어요. 다시 요청해 주세요.' });
});
