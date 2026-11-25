import { beforeEach, expect, test, vi } from 'vitest';

const LEAD = '44444444-4444-4444-8444-444444444444';
type Res = { ok: true; data: unknown } | { ok: false; status: number; error: { code: string; message: string } };
const calls: { path: string; params: Record<string, unknown> }[] = [];
let apiResponse: Res = { ok: true, data: { data: { result: 'ok' } } };

const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
  calls.push({ path: url, params: (JSON.parse(init.body) as { params: Record<string, unknown> }).params });
  if (apiResponse.ok) return new Response(JSON.stringify(apiResponse.data), { status: 200 });
  return new Response(JSON.stringify({ error: apiResponse.error }), { status: apiResponse.status });
});
vi.stubGlobal('fetch', fetchMock);
vi.stubEnv('BARA_API_URL', 'http://api.test');
vi.mock('@/lib/db/service-key', () => ({ getServiceKey: async () => 'svc-key', getPiiRevealSecret: async () => 's' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'admin-tok' }) }),
  headers: async () => ({ get: () => null }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
const requireAdmin = vi.fn(async () => ({}));
vi.mock('@/lib/supabase/require-admin', () => ({ requireAdminClient: () => requireAdmin() }));
const logAdminAccess = vi.fn();
vi.mock('@/lib/supabase/admin-queries', () => ({ logAdminAccess: (...a: unknown[]) => logAdminAccess(...a) }));

import { closeLead, markLeadContacted, updateLeadNote } from '@/app/actions/admin-diagnosis';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const respond = (data: unknown) => {
  apiResponse = { ok: true, data: { data } };
};
const dest = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as Error).message.replace('REDIRECT:', '');
  }
  return 'no-redirect';
};

beforeEach(() => {
  calls.length = 0;
  logAdminAccess.mockClear();
  requireAdmin.mockClear();
  respond({ result: 'ok' });
});

test('연락함 표시: API 오퍼레이션 한 번(상태 전환)만 부르고 앱에서 logAdminAccess를 따로 부르지 않는다', async () => {
  expect(await dest(markLeadContacted(LEAD, form({ note: ' 통화함 ' })))).toBe('/admin/selfcheck/leads?success=contacted');
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toContain('/v1/op/admin.updateDiagnosisLead');
  expect(calls[0].params).toEqual({ leadId: LEAD, change: 'contacted', note: '통화함' });
  expect(logAdminAccess).not.toHaveBeenCalled();
});

test('종료: 사유 없으면 API를 부르지 않고, 있으면 fromStatus와 함께 보낸다', async () => {
  expect(await dest(closeLead(LEAD, 'new', form({ reason: '  ' })))).toBe('/admin/selfcheck/leads?error=reason-required');
  expect(calls).toHaveLength(0);
  expect(await dest(closeLead(LEAD, 'contacted', form({ reason: '안내 완료' })))).toBe('/admin/selfcheck/leads?success=closed');
  expect(calls[0].params).toEqual({ leadId: LEAD, change: 'closed', fromStatus: 'contacted', note: '안내 완료' });
  expect(logAdminAccess).not.toHaveBeenCalled();
});

test('메모 수정: note 변경으로 보내고, 비우면 null', async () => {
  expect(await dest(updateLeadNote(LEAD, form({ note: '' })))).toBe('/admin/selfcheck/leads?success=note-updated');
  expect(calls[0].params).toEqual({ leadId: LEAD, change: 'note', note: null });
  respond({ result: 'unchanged' });
  expect(await dest(updateLeadNote(LEAD, form({ note: '가' })))).toBe('/admin/selfcheck/leads?success=note-updated');
  expect(logAdminAccess).not.toHaveBeenCalled();
});

test('API 결과별 안내: 이미 처리, 개인정보 메모, 기록 실패(503), 그 밖의 실패', async () => {
  respond({ result: 'already_processed' });
  expect(await dest(markLeadContacted(LEAD, form({})))).toBe('/admin/selfcheck/leads?error=already-processed');
  respond({ result: 'validation', field: 'note', reason: 'memo_has_pii' });
  expect(await dest(updateLeadNote(LEAD, form({ note: '010-1234-5678' })))).toBe('/admin/selfcheck/leads?error=memo-pii');
  respond({ result: 'validation', field: 'note', reason: 'reason_required' });
  expect(await dest(closeLead(LEAD, 'new', form({ reason: 'x' })))).toBe('/admin/selfcheck/leads?error=reason-required');
  apiResponse = { ok: false, status: 503, error: { code: 'unavailable', message: 'log_failed' } };
  expect(await dest(updateLeadNote(LEAD, form({ note: 'a' })))).toBe('/admin/selfcheck/leads?error=log-failed');
  apiResponse = { ok: false, status: 500, error: { code: 'internal', message: 'x' } };
  expect(await dest(updateLeadNote(LEAD, form({ note: 'a' })))).toBe('/admin/selfcheck/leads?error=failed');
  respond({ result: 'forbidden' });
  expect(await dest(updateLeadNote(LEAD, form({ note: 'a' })))).toBe('/admin/selfcheck/leads?error=failed');
  apiResponse = { ok: false, status: 401, error: { code: 'unauthenticated', message: 'x' } };
  expect(await dest(updateLeadNote(LEAD, form({ note: 'a' })))).toBe('/sign-in');
});

test('네트워크 예외도 액션이 죽지 않고 failed 배너', async () => {
  fetchMock.mockRejectedValueOnce(new Error('down'));
  expect(await dest(updateLeadNote(LEAD, form({ note: 'a' })))).toBe('/admin/selfcheck/leads?error=failed');
});
