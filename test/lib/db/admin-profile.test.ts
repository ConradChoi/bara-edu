import { beforeEach, expect, test, vi } from 'vitest';

type Res = { ok: true; data: unknown } | { ok: false; status: number; error: { code: string; message: string } };
const apiFetch = vi.fn<(p: string, i: { body?: unknown; session?: string | null }) => Promise<Res>>();
vi.mock('@/lib/db/api', () => ({ apiFetch: (p: string, i: never) => apiFetch(p, i) }));
vi.mock('@/lib/db/session-cookie', () => ({ readSession: async () => 'tok' }));

import { listMemberProfileEditsApi, updateMemberProfileApi } from '@/lib/db/admin-profile';

beforeEach(() => apiFetch.mockReset());

const input = { memberId: 'm1', name: '홍길동', expected: { name: '홍길순' }, reason: 'member_request', identityChecked: true } as const;
const ok = (data: unknown): Res => ({ ok: true, data: { data } });
const profile = { name: '홍길동', phone: null };

test('오퍼레이션을 세션·params로 부르고 성공 값을 돌려준다', async () => {
  apiFetch.mockResolvedValue(ok({ result: 'ok', changed: ['name'], profile, mailQueued: true }));
  expect(await updateMemberProfileApi(input)).toEqual({ ok: true, unchanged: false, changed: ['name'], profile, mailQueued: true });
  expect(apiFetch).toHaveBeenCalledWith('/v1/op/admin.updateMemberProfile', { method: 'POST', session: 'tok', body: { params: input } });
});

test('unchanged·stale·validation·거절 결과를 구분해 돌려준다', async () => {
  apiFetch.mockResolvedValueOnce(ok({ result: 'unchanged', changed: [], profile }));
  expect(await updateMemberProfileApi(input)).toEqual({ ok: true, unchanged: true, changed: [], profile });
  apiFetch.mockResolvedValueOnce(ok({ result: 'stale', current: profile }));
  expect(await updateMemberProfileApi(input)).toEqual({ ok: false, reason: 'stale', current: profile });
  apiFetch.mockResolvedValueOnce(ok({ result: 'validation', field: 'memo', reason: 'memo_has_pii' }));
  expect(await updateMemberProfileApi(input)).toEqual({ ok: false, reason: 'validation', field: 'memo', code: 'memo_has_pii' });
  for (const r of ['withdrawn', 'not_confirmed', 'target_is_admin', 'no_email', 'not_found', 'forbidden'] as const) {
    apiFetch.mockResolvedValueOnce(ok({ result: r }));
    expect(await updateMemberProfileApi(input)).toEqual({ ok: false, reason: r });
  }
});

test('HTTP 오류: 401, 503 log_failed, 400, 그 밖과 예외는 failed', async () => {
  apiFetch.mockResolvedValueOnce({ ok: false, status: 401, error: { code: 'unauthenticated', message: 'x' } });
  expect(await updateMemberProfileApi(input)).toEqual({ ok: false, reason: 'unauthenticated' });
  apiFetch.mockResolvedValueOnce({ ok: false, status: 503, error: { code: 'unavailable', message: 'log_failed' } });
  expect(await updateMemberProfileApi(input)).toEqual({ ok: false, reason: 'log_failed' });
  apiFetch.mockResolvedValueOnce({ ok: false, status: 503, error: { code: 'unavailable', message: '서비스에 일시적으로 연결할 수 없어요.' } });
  expect(await updateMemberProfileApi(input)).toEqual({ ok: false, reason: 'failed' });
  apiFetch.mockResolvedValueOnce({ ok: false, status: 400, error: { code: 'validation', message: 'x' } });
  expect(await updateMemberProfileApi(input)).toEqual({ ok: false, reason: 'validation' });
  apiFetch.mockRejectedValueOnce(new Error('down'));
  expect(await updateMemberProfileApi(input)).toEqual({ ok: false, reason: 'failed' });
});

test('이력 조회: 기본 5건, 결과 매핑', async () => {
  apiFetch.mockResolvedValueOnce(ok({ result: 'ok', items: [{ at: 't', adminName: null, fields: ['name'], reason: 'typo_fix', memo: null }], hasMore: true }));
  expect(await listMemberProfileEditsApi('m1')).toEqual({ ok: true, items: [{ at: 't', adminName: null, fields: ['name'], reason: 'typo_fix', memo: null }], hasMore: true });
  expect(apiFetch).toHaveBeenCalledWith('/v1/op/admin.listMemberProfileEdits', { method: 'POST', session: 'tok', body: { params: { memberId: 'm1', limit: 5 } } });
  apiFetch.mockResolvedValueOnce(ok({ result: 'forbidden' }));
  expect(await listMemberProfileEditsApi('m1')).toEqual({ ok: false, reason: 'forbidden' });
  apiFetch.mockRejectedValueOnce(new Error('down'));
  expect(await listMemberProfileEditsApi('m1')).toEqual({ ok: false, reason: 'failed' });
});
