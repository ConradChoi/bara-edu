import { beforeEach, expect, test, vi } from 'vitest';

const UID = '11111111-1111-4111-8111-111111111111';
type Init = { method?: string; body?: Record<string, unknown>; session?: string | null };
type Res = { ok: true; data: unknown } | { ok: false; status: number; error: { code: string; message: string } };

const calls: { label: string; init: Init }[] = [];
let failAt: string | string[] | null = null;
let failWith = { status: 500, code: 'internal', message: 'x' };
let photoPath: string | null = `${UID}/photo`;

const label = (path: string, init: Init) => (path === '/v1/query' ? `${init.body?.action}:${init.body?.table}` : path);
const ok = (data: unknown): Res => ({ ok: true, data });

const apiFetch = vi.fn(async (path: string, init: Init): Promise<Res> => {
  const l = label(path, init);
  calls.push({ label: l, init });
  if (l === failAt || (Array.isArray(failAt) && failAt.includes(l))) {
    return { ok: false, status: failWith.status, error: { code: failWith.code, message: failWith.message } };
  }
  switch (l) {
    case '/v1/auth/session':
      return ok({ user: { id: UID, email: 'a@b.kr', emailConfirmedAt: null }, profile: { role: 'learner', status: 'active' } });
    case 'select:enrollments':
      return ok({ data: [] });
    case 'select:profiles':
      return ok({ data: { photo_path: photoPath, address: '서울', role: 'learner' } });
    case 'update:profiles':
      return ok({ data: null });
    case '/v1/storage/member-photos':
      return ok({ path: `${UID}/photo` });
    default:
      return ok({ ok: true });
  }
});
vi.mock('@/lib/db/api', () => ({ apiFetch: (path: string, init: Init) => apiFetch(path, init) }));

const store = { get: vi.fn(() => ({ value: 'tok' })), set: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => ({ get: () => null }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { updateContactInfo, withdraw } from '@/app/actions/account';
import { memberPhotoSignedUrl, uploadMemberPhoto } from '@/lib/db/storage';

const form = (fields: Record<string, string | File>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const run = (p: Promise<unknown>) => p.then(() => 'no redirect', (e: Error) => e.message);
const steps = () => calls.map((c) => c.label);
const callTo = (l: string) => calls.find((c) => c.label === l)!;
const jpeg = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return new File([bytes], 'me.jpg', { type: 'image/jpeg' });
};

beforeEach(() => {
  calls.length = 0;
  failAt = null;
  failWith = { status: 500, code: 'internal', message: 'x' };
  photoPath = `${UID}/photo`;
  apiFetch.mockClear();
  store.delete.mockClear();
});

test('withdraw: /v1/account/withdraw 한 번만 호출하고 쿠키를 지운 뒤 /?withdrawn=1', async () => {
  expect(await run(withdraw(form({ reason: 'no_longer_needed', detail: ' 이유 ' })))).toBe('REDIRECT:/?withdrawn=1');
  expect(steps()).toEqual(['/v1/account/withdraw']);
  expect(callTo('/v1/account/withdraw').init).toMatchObject({
    method: 'POST',
    session: 'tok',
    body: { reason: 'no_longer_needed', detail: '이유' },
  });
  expect(store.delete).toHaveBeenCalledWith('bara_session');
});

test('withdraw: 상세 사유가 없으면 detail은 null', async () => {
  await run(withdraw(form({ reason: 'other' })));
  expect(callTo('/v1/account/withdraw').init.body).toEqual({ reason: 'other', detail: null });
});

test('withdraw: 사유가 없거나 목록에 없으면 API를 부르지 않고 validation', async () => {
  expect(await run(withdraw(form({})))).toBe('REDIRECT:/my?withdrawError=validation');
  expect(await run(withdraw(form({ reason: 'made_up' })))).toBe('REDIRECT:/my?withdrawError=validation');
  expect(steps()).toEqual([]);
});

test('withdraw: 진행 중 수강(409 active_enrollment) → /my?withdrawError=active-enrollment, 쿠키 유지', async () => {
  failAt = '/v1/account/withdraw';
  failWith = { status: 409, code: 'conflict', message: 'active_enrollment' };
  expect(await run(withdraw(form({ reason: 'other' })))).toBe('REDIRECT:/my?withdrawError=active-enrollment');
  expect(store.delete).not.toHaveBeenCalled();
});

test('withdraw: 세션이 없거나 만료(401 unauthenticated) → /sign-in', async () => {
  failAt = '/v1/account/withdraw';
  failWith = { status: 401, code: 'unauthenticated', message: 'x' };
  expect(await run(withdraw(form({ reason: 'other' })))).toBe('REDIRECT:/sign-in');
});

test('withdraw: API 실패(500)·연결 예외 → /my?withdrawError=failed, 쿠키 유지', async () => {
  failAt = '/v1/account/withdraw';
  expect(await run(withdraw(form({ reason: 'other' })))).toBe('REDIRECT:/my?withdrawError=failed');
  failAt = null;
  apiFetch.mockRejectedValueOnce(new Error('service key unavailable'));
  expect(await run(withdraw(form({ reason: 'other' })))).toBe('REDIRECT:/my?withdrawError=failed');
  expect(store.delete).not.toHaveBeenCalled();
});

test('사진 업로드 6MB → 기존 오류 문구', async () => {
  expect(await run(updateContactInfo(form({ photo: jpeg(6 * 1024 * 1024) })))).toBe('REDIRECT:/my?settingsError=photo-too-large');
  expect(calls.map((c) => c.label)).not.toContain('/v1/storage/member-photos');
  expect(await uploadMemberPhoto(jpeg(6 * 1024 * 1024))).toEqual({ error: 'too-large' });
  expect(calls.map((c) => c.label)).not.toContain('/v1/storage/member-photos');
});

test('사진 업로드: GIF·임의 바이트는 거부하고 보내지 않는다', async () => {
  const gif = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0, 0, 0, 0, 0, 0, 0, 0])], 'a.gif');
  expect(await uploadMemberPhoto(gif)).toEqual({ error: 'invalid' });
  expect(await run(updateContactInfo(form({ photo: gif })))).toBe('REDIRECT:/my?settingsError=photo-invalid');
  expect(calls.map((c) => c.label)).not.toContain('/v1/storage/member-photos');
});

test('사진 업로드: fileName=photo, 감지한 contentType, base64 본문으로 보낸다', async () => {
  const file = jpeg(16);
  expect(await uploadMemberPhoto(file)).toEqual({ path: `${UID}/photo` });
  const sent = callTo('/v1/storage/member-photos').init;
  expect(sent).toMatchObject({ method: 'POST', session: 'tok' });
  expect(sent.body).toEqual({
    fileName: 'photo',
    contentType: 'image/jpeg',
    dataBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
  });
});

test('사진 업로드 실패 → 기존 실패 문구', async () => {
  failAt = '/v1/storage/member-photos';
  expect(await uploadMemberPhoto(jpeg(16))).toEqual({ error: 'failed' });
  expect(await run(updateContactInfo(form({ photo: jpeg(16) })))).toBe('REDIRECT:/my?settingsError=failed');
});

test('서명 URL·삭제: 성공 값과 실패 시 null/false', async () => {
  apiFetch.mockResolvedValueOnce(ok({ url: 'https://s3/signed' }));
  expect(await memberPhotoSignedUrl(`${UID}/photo`)).toBe('https://s3/signed');
  expect(apiFetch).toHaveBeenLastCalledWith('/v1/storage/member-photos/signed-url', {
    method: 'POST',
    session: 'tok',
    body: { path: `${UID}/photo` },
  });
  apiFetch.mockResolvedValueOnce({ ok: false, status: 403, error: { code: 'forbidden', message: 'x' } });
  expect(await memberPhotoSignedUrl(`${UID}/photo`)).toBeNull();
});
