import { beforeEach, expect, test, vi } from 'vitest';

type Res = { ok: true; data: unknown } | { ok: false; status: number; error: { code: string; message: string } };
const apiFetch = vi.fn<(path: string, init: { method?: string; body?: Record<string, unknown>; session?: string | null }) => Promise<Res>>();
vi.mock('@/lib/db/api', () => ({ apiFetch: (p: string, i: never) => apiFetch(p, i) }));
let session: string | null = 'tok';
vi.mock('@/lib/db/session-cookie', () => ({ readSession: async () => session }));

import { memberPhotoSignedUrl, uploadMemberPhoto } from '@/lib/db/storage';

const MB = 1024 * 1024;
const file = (head: number[], size = 16) => {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return new File([bytes], 'x');
};
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const GIF = [0x47, 0x49, 0x46, 0x38];
const sent = () => apiFetch.mock.calls[0][1].body as { fileName: string; contentType: string; dataBase64: string };

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, data: { path: 'u1/photo' } });
  session = 'tok';
});

test.each([
  ['JPEG', JPEG, 'image/jpeg'],
  ['PNG', PNG, 'image/png'],
  ['WebP', WEBP, 'image/webp'],
])('%s는 감지한 contentType으로 업로드한다 (File.type은 무시)', async (_n, head, type) => {
  const f = new File([new Uint8Array([...head, 1, 2, 3, 4, 5, 6, 7, 8])], 'x.bin', { type: 'text/plain' });
  expect(await uploadMemberPhoto(f)).toEqual({ path: 'u1/photo' });
  expect(sent().contentType).toBe(type);
  expect(sent().fileName).toBe('photo');
  expect(apiFetch.mock.calls[0][0]).toBe('/v1/storage/member-photos');
  expect(apiFetch.mock.calls[0][1].session).toBe('tok');
});

test('GIF·SVG·임의 바이트·빈 파일은 invalid, API를 부르지 않는다', async () => {
  const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'a.svg', { type: 'image/jpeg' });
  for (const f of [file(GIF), svg, file([1, 2, 3, 4]), new File([], 'e.jpg')]) {
    expect(await uploadMemberPhoto(f)).toEqual({ error: 'invalid' });
  }
  expect(apiFetch).not.toHaveBeenCalled();
});

test('크기 경계: 5MB는 통과, 5MB+1바이트는 too-large(API 호출 없음)', async () => {
  expect(await uploadMemberPhoto(file(JPEG, 5 * MB))).toEqual({ path: 'u1/photo' });
  apiFetch.mockClear();
  expect(await uploadMemberPhoto(file(JPEG, 5 * MB + 1))).toEqual({ error: 'too-large' });
  expect(apiFetch).not.toHaveBeenCalled();
});

test('크기 검사가 형식 검사보다 먼저다 (큰 GIF도 too-large)', async () => {
  expect(await uploadMemberPhoto(file(GIF, 6 * MB))).toEqual({ error: 'too-large' });
});

test('본문은 파일 바이트의 base64', async () => {
  const f = file(JPEG, 10);
  await uploadMemberPhoto(f);
  expect(sent().dataBase64).toBe(Buffer.from(await f.arrayBuffer()).toString('base64'));
});

test('API 오류 응답·네트워크 예외·세션 읽기 실패는 모두 failed', async () => {
  apiFetch.mockResolvedValueOnce({ ok: false, status: 500, error: { code: 'internal', message: 'x' } });
  expect(await uploadMemberPhoto(file(JPEG))).toEqual({ error: 'failed' });
  apiFetch.mockRejectedValueOnce(new Error('service key unavailable'));
  expect(await uploadMemberPhoto(file(JPEG))).toEqual({ error: 'failed' });
});

test('세션이 없으면 session=null로 보내고 API의 401을 failed로 돌려준다', async () => {
  session = null;
  apiFetch.mockResolvedValueOnce({ ok: false, status: 401, error: { code: 'unauthenticated', message: 'x' } });
  expect(await uploadMemberPhoto(file(JPEG))).toEqual({ error: 'failed' });
  expect(apiFetch.mock.calls[0][1].session).toBeNull();
});

test('memberPhotoSignedUrl: 성공은 url, 실패·예외는 null', async () => {
  apiFetch.mockResolvedValueOnce({ ok: true, data: { url: 'https://s3/x' } });
  expect(await memberPhotoSignedUrl('u1/photo')).toBe('https://s3/x');
  expect(apiFetch).toHaveBeenLastCalledWith('/v1/storage/member-photos/signed-url', { method: 'POST', session: 'tok', body: { path: 'u1/photo' } });
  apiFetch.mockResolvedValueOnce({ ok: false, status: 403, error: { code: 'forbidden', message: 'x' } });
  expect(await memberPhotoSignedUrl('u1/photo')).toBeNull();
  apiFetch.mockRejectedValueOnce(new Error('down'));
  expect(await memberPhotoSignedUrl('u1/photo')).toBeNull();
});
