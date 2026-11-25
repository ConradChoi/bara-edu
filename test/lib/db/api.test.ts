import { beforeEach, expect, test, vi } from 'vitest';

const headerValues: Record<string, string> = {};
let headersThrows = false;
vi.mock('next/headers', () => ({
  headers: async () => {
    if (headersThrows) throw new Error('outside request');
    return { get: (k: string) => headerValues[k] ?? null };
  },
  cookies: async () => ({}),
}));
let keyThrows = false;
vi.mock('@/lib/db/service-key', () => ({
  getServiceKey: async () => {
    if (keyThrows) throw new Error('service key unavailable');
    return 'secret-key';
  },
}));

import { apiFetch } from '@/lib/db/api';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.BARA_API_URL = 'http://api.local:3001';
  for (const k of Object.keys(headerValues)) delete headerValues[k];
  headersThrows = false;
  keyThrows = false;
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('apiFetch가 키·세션·클라이언트 IP 헤더를 붙인다', async () => {
  headerValues['x-forwarded-for'] = '6.6.6.6, 203.0.113.7 , 130.176.1.1';
  fetchMock.mockResolvedValue(json(200, { hello: 1 }));
  const r = await apiFetch<{ hello: number }>('/v1/x', { method: 'POST', body: { a: 1 }, session: 'tok' });
  expect(r).toEqual({ ok: true, data: { hello: 1 } });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('http://api.local:3001/v1/x');
  expect(init.method).toBe('POST');
  expect(init.body).toBe('{"a":1}');
  expect(init.headers['x-bara-service-key']).toBe('secret-key');
  expect(init.headers['x-bara-session']).toBe('tok');
  expect(init.headers['x-bara-client-ip']).toBe('203.0.113.7');
  expect(init.headers['content-type']).toBe('application/json');
  expect(init.signal).toBeInstanceOf(AbortSignal);
});

test('세션·IP가 없으면 해당 헤더를 보내지 않는다 (headers() 실패 포함)', async () => {
  fetchMock.mockResolvedValue(json(200, {}));
  await apiFetch('/v1/x', {});
  expect(fetchMock.mock.calls[0][1].headers['x-bara-session']).toBeUndefined();
  expect(fetchMock.mock.calls[0][1].headers['x-bara-client-ip']).toBeUndefined();
  expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  headersThrows = true;
  await apiFetch('/v1/x', { session: null });
  expect(fetchMock.mock.calls[1][1].headers['x-bara-client-ip']).toBeUndefined();
});

test('위조된 XFF 맨 앞 값은 무시하고 cloudfront-viewer-address를 우선한다', async () => {
  headerValues['x-forwarded-for'] = '6.6.6.6, 203.0.113.9, 130.176.1.1';
  headerValues['cloudfront-viewer-address'] = '203.0.113.7:4444';
  fetchMock.mockResolvedValue(json(200, {}));
  await apiFetch('/v1/x', {});
  expect(fetchMock.mock.calls[0][1].headers['x-bara-client-ip']).toBe('203.0.113.7');
});

test('clientIp를 넘기면 headers()를 쓰지 않고 그 값을 보낸다 (null이면 생략)', async () => {
  headersThrows = true;
  fetchMock.mockResolvedValue(json(200, {}));
  await apiFetch('/v1/x', { clientIp: '198.51.100.2' });
  expect(fetchMock.mock.calls[0][1].headers['x-bara-client-ip']).toBe('198.51.100.2');
  headersThrows = false;
  headerValues['x-forwarded-for'] = '203.0.113.7';
  await apiFetch('/v1/x', { clientIp: null });
  expect(fetchMock.mock.calls[1][1].headers['x-bara-client-ip']).toBeUndefined();
});

test('API 오류 응답 → ok:false + error 그대로', async () => {
  const error = { code: 'db_error', message: 'dup', sqlstate: '23505' };
  fetchMock.mockResolvedValue(json(400, { error }));
  expect(await apiFetch('/v1/x', {})).toEqual({ ok: false, status: 400, error });
});

test('400 validation의 field는 error에 그대로 실린다 (없으면 키도 없다)', async () => {
  const error = { code: 'validation', message: 'x', field: 'email' };
  fetchMock.mockResolvedValueOnce(json(400, { error }));
  expect(await apiFetch('/v1/x', {})).toEqual({ ok: false, status: 400, error });
  fetchMock.mockResolvedValueOnce(json(400, { error: { code: 'validation', message: 'x' } }));
  const r = await apiFetch('/v1/x', {});
  expect(r.ok === false && 'field' in r.error).toBe(false);
});

test('JSON이 아니거나 모양이 틀린 오류 본문 → internal', async () => {
  const internal = { code: 'internal', message: '요청을 처리하지 못했어요.' };
  fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 502 }));
  expect(await apiFetch('/v1/x', {})).toEqual({ ok: false, status: 502, error: internal });
  fetchMock.mockResolvedValueOnce(json(500, { nope: 1 }));
  expect(await apiFetch('/v1/x', {})).toEqual({ ok: false, status: 500, error: internal });
});

test('fetch 예외 → 503 unavailable (키가 메시지에 없다)', async () => {
  fetchMock.mockRejectedValue(new Error('ECONNREFUSED secret-key'));
  const r = await apiFetch('/v1/x', {});
  expect(r).toEqual({
    ok: false,
    status: 503,
    error: { code: 'unavailable', message: '서비스에 일시적으로 연결할 수 없어요.' },
  });
});

test('BARA_API_URL이 없으면 설정 오류로 throw', async () => {
  delete process.env.BARA_API_URL;
  await expect(apiFetch('/v1/x', {})).rejects.toThrow('BARA_API_URL');
});

test('서비스 키를 못 읽으면 throw 대신 503 unavailable, API는 부르지 않는다', async () => {
  keyThrows = true;
  const r = await apiFetch('/v1/x', { method: 'POST', body: {} });
  expect(r).toEqual({ ok: false, status: 503, error: { code: 'unavailable', message: '서비스에 일시적으로 연결할 수 없어요.' } });
  expect(fetchMock).not.toHaveBeenCalled();
});
