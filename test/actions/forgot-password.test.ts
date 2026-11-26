import { beforeEach, expect, test, vi } from 'vitest';

// ---- 비밀번호 찾기 서버 액션 requestPasswordReset (정의서 2장, 5.2 열거 방지, 5.3) ----
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }),
  headers: async () => ({ get: (k: string) => (k === 'host' ? 'bara-edu.kr' : k === 'x-forwarded-for' ? '203.0.113.7' : null) }),
}));
vi.mock('@/lib/db/service-key', () => ({ getServiceKey: async () => 'secret-key' }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));

import { requestPasswordReset } from '@/app/actions/auth';

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, code: string, field?: string) => json(status, { error: { code, message: 'm', ...(field ? { field } : {}) } });
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const run = (fields: Record<string, string>) => requestPasswordReset(undefined, form(fields));
const sentBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.BARA_API_URL = 'http://api.local';
});

test('빈 값·형식 오류는 API를 부르지 않는다(앞뒤 공백 제거 후 검사)', async () => {
  expect(await run({ email: '   ' })).toEqual({ error: 'empty', email: '', resend: false });
  expect(await run({})).toEqual({ error: 'empty', email: '', resend: false });
  expect(await run({ email: 'a@b' })).toEqual({ error: 'format', email: 'a@b', resend: false });
  expect(await run({ email: '한글@b.kr' })).toEqual({ error: 'format', email: '한글@b.kr', resend: false });
  expect(await run({ email: `${'a'.repeat(250)}@b.kr` })).toMatchObject({ error: 'format' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('성공: 이메일을 trim해 origin과 함께 보내고 회원 IP를 넘긴다 → requested', async () => {
  fetchMock.mockResolvedValue(json(200, { ok: true }));
  expect(await run({ email: '  A@B.kr ' })).toEqual({ requested: true, email: 'A@B.kr', resend: false });
  expect(fetchMock.mock.calls[0][0]).toBe('http://api.local/v1/auth/request-reset');
  expect(sentBody()).toEqual({ email: 'A@B.kr', origin: 'https://bara-edu.kr' });
  expect(fetchMock.mock.calls[0][1].headers['x-bara-client-ip']).toBe('203.0.113.7');
});

test('열거 방지: 200이면 응답 본문과 관계없이 늘 같은 상태(서버 값을 싣지 않는다)', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
  const a = await run({ email: 'member@b.kr' });
  fetchMock.mockResolvedValueOnce(json(200, { ok: true, mailSent: false, exists: false }));
  const b = await run({ email: 'nobody@b.kr' });
  expect(Object.keys(a!).sort()).toEqual(Object.keys(b!).sort());
  expect(a).toEqual({ requested: true, email: 'member@b.kr', resend: false });
  expect(b).toEqual({ requested: true, email: 'nobody@b.kr', resend: false });
});

test('보냄 화면의 [메일 다시 받기](resend=1)는 resend: true로 돌아온다', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
  expect(await run({ email: 'a@b.kr', resend: '1' })).toEqual({ requested: true, email: 'a@b.kr', resend: true });
  fetchMock.mockResolvedValueOnce(apiError(429, 'rate_limited'));
  expect(await run({ email: 'a@b.kr', resend: '1' })).toEqual({ error: 'rate_limited', email: 'a@b.kr', resend: true });
});

test('실패 매핑: 429 → rate_limited, 503·네트워크 → unavailable, 400 email → format, origin·401·500 → failed (입력 유지용 email 포함)', async () => {
  const cases: Array<[Response | Error, string]> = [
    [apiError(429, 'rate_limited'), 'rate_limited'],
    [apiError(503, 'unavailable'), 'unavailable'],
    [new Error('down'), 'unavailable'],
    [apiError(400, 'validation', 'email'), 'format'],
    [apiError(400, 'validation', 'origin'), 'failed'],
    [apiError(401, 'unauthorized_service'), 'failed'],
    [apiError(500, 'internal'), 'failed'],
  ];
  for (const [res, error] of cases) {
    if (res instanceof Error) fetchMock.mockRejectedValueOnce(res);
    else fetchMock.mockResolvedValueOnce(res);
    expect(await run({ email: 'a@b.kr' })).toEqual({ error, email: 'a@b.kr', resend: false });
  }
});
