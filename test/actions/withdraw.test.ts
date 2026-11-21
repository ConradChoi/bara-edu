import { beforeEach, expect, test, vi } from 'vitest';

const UID = '11111111-1111-4111-8111-111111111111';
type Init = { method?: string; body?: Record<string, unknown>; session?: string | null };
type Res = { ok: true; data: unknown } | { ok: false; status: number; error: { code: string; message: string } };

const calls: { label: string; init: Init }[] = [];
let failAt: string | string[] | null = null;
let photoPath: string | null = `${UID}/photo`;

const label = (path: string, init: Init) => (path === '/v1/query' ? `${init.body?.action}:${init.body?.table}` : path);
const ok = (data: unknown): Res => ({ ok: true, data });

const apiFetch = vi.fn(async (path: string, init: Init): Promise<Res> => {
  const l = label(path, init);
  calls.push({ label: l, init });
  if (l === failAt || (Array.isArray(failAt) && failAt.includes(l))) {
    return { ok: false, status: 500, error: { code: 'internal', message: 'x' } };
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
import { memberPhotoSignedUrl, removeMemberPhoto, uploadMemberPhoto } from '@/lib/db/storage';

const form = (fields: Record<string, string | File>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const run = (p: Promise<unknown>) => p.then(() => 'no redirect', (e: Error) => e.message);
const WITHDRAW_STEPS = [
  '/v1/auth/withdraw-anonymize',
  'update:profiles',
  '/v1/op/account.withdrawCleanup',
  '/v1/storage/member-photos/remove',
  '/v1/auth/logout-all',
];
const steps = () => calls.map((c) => c.label).filter((l) => WITHDRAW_STEPS.includes(l));
const callTo = (l: string) => calls.find((c) => c.label === l)!;
const jpeg = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return new File([bytes], 'me.jpg', { type: 'image/jpeg' });
};

beforeEach(() => {
  calls.length = 0;
  failAt = null;
  photoPath = `${UID}/photo`;
  apiFetch.mockClear();
  store.delete.mockClear();
});

test('withdraw: 경로 호출 순서가 anonymize → profiles update → withdrawCleanup → remove → logout-all', async () => {
  expect(await run(withdraw(form({ reason: 'no_longer_needed' })))).toBe('REDIRECT:/?withdrawn=1');
  expect(steps()).toEqual(WITHDRAW_STEPS);
  expect(callTo('/v1/auth/withdraw-anonymize').init).toMatchObject({
    method: 'POST',
    session: 'tok',
    body: { anonymizedEmail: `withdrawn+${UID}@deleted.invalid` },
  });
  expect(callTo('update:profiles').init.body?.values).toMatchObject({
    name: '탈퇴한 회원',
    email: `withdrawn+${UID}@deleted.invalid`,
    photo_path: null,
    status: 'withdrawn',
    withdrawal_reason: 'no_longer_needed',
  });
  expect(callTo('/v1/op/account.withdrawCleanup').init).toMatchObject({ method: 'POST', session: 'tok', body: { params: {} } });
  expect(callTo('/v1/storage/member-photos/remove').init.body).toEqual({ path: `${UID}/photo` });
  expect(callTo('/v1/auth/logout-all').init).toMatchObject({ method: 'POST', session: 'tok' });
  expect(store.delete).toHaveBeenCalledWith('bara_session');
});

test('withdraw: withdrawCleanup 실패 → /my?withdrawError=failed, logout-all 호출 안 함', async () => {
  failAt = '/v1/op/account.withdrawCleanup';
  expect(await run(withdraw(form({ reason: 'no_longer_needed' })))).toBe('REDIRECT:/my?withdrawError=failed');
  expect(steps()).toEqual(WITHDRAW_STEPS.slice(0, 3));
  expect(store.delete).not.toHaveBeenCalled();
});

test('withdraw: anonymize 실패 → /my?withdrawError=failed, 이후 단계 없음', async () => {
  failAt = '/v1/auth/withdraw-anonymize';
  expect(await run(withdraw(form({ reason: 'no_longer_needed' })))).toBe('REDIRECT:/my?withdrawError=failed');
  expect(steps()).toEqual(WITHDRAW_STEPS.slice(0, 1));
  expect(store.delete).not.toHaveBeenCalled();
});

test('withdraw: profiles update 실패 → /my?withdrawError=failed, cleanup 호출 안 함', async () => {
  failAt = 'update:profiles';
  expect(await run(withdraw(form({ reason: 'no_longer_needed' })))).toBe('REDIRECT:/my?withdrawError=failed');
  expect(steps()).toEqual(WITHDRAW_STEPS.slice(0, 2));
});

test('withdraw: 사진 삭제·logout-all 실패는 무시하고 쿠키를 지운 뒤 성공 처리', async () => {
  failAt = ['/v1/storage/member-photos/remove', '/v1/auth/logout-all'];
  expect(await run(withdraw(form({ reason: 'no_longer_needed' })))).toBe('REDIRECT:/?withdrawn=1');
  expect(steps()).toEqual(WITHDRAW_STEPS);
  expect(store.delete).toHaveBeenCalledWith('bara_session');
});

test('withdraw: 사진이 없으면 삭제 경로를 부르지 않는다', async () => {
  photoPath = null;
  expect(await run(withdraw(form({ reason: 'no_longer_needed' })))).toBe('REDIRECT:/?withdrawn=1');
  expect(steps()).not.toContain('/v1/storage/member-photos/remove');
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
  apiFetch.mockRejectedValueOnce(new Error('service key unavailable'));
  expect(await removeMemberPhoto(`${UID}/photo`)).toBe(false);
});
