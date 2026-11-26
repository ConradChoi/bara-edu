import { beforeEach, expect, test, vi } from 'vitest';

type Res = { ok: true; data: unknown } | { ok: false; status: number; error: { code: string; message: string } };
const apiFetch = vi.fn<(p: string, i: { body?: unknown; session?: string | null }) => Promise<Res>>();
vi.mock('@/lib/db/api', () => ({ apiFetch: (p: string, i: never) => apiFetch(p, i) }));
vi.mock('@/lib/db/session-cookie', () => ({ readSession: async () => 'tok' }));

import { getDiagnosisResultDetailApi, updateDiagnosisLeadApi } from '@/lib/db/admin-diagnosis';

beforeEach(() => apiFetch.mockReset());
const ok = (data: unknown): Res => ({ ok: true, data: { data } });

test('리드 변경: 오퍼레이션을 세션·params로 부르고 결과를 구분한다', async () => {
  apiFetch.mockResolvedValueOnce(ok({ result: 'ok' }));
  expect(await updateDiagnosisLeadApi({ leadId: 'l', change: 'note', note: 'n' })).toEqual({ ok: true, unchanged: false });
  expect(apiFetch).toHaveBeenCalledWith('/v1/op/admin.updateDiagnosisLead', { method: 'POST', session: 'tok', body: { params: { leadId: 'l', change: 'note', note: 'n' } } });
  apiFetch.mockResolvedValueOnce(ok({ result: 'unchanged' }));
  expect(await updateDiagnosisLeadApi({ leadId: 'l', change: 'note' })).toEqual({ ok: true, unchanged: true });
  apiFetch.mockResolvedValueOnce({ ok: false, status: 503, error: { code: 'unavailable', message: 'log_failed' } });
  expect(await updateDiagnosisLeadApi({ leadId: 'l', change: 'contacted' })).toEqual({ ok: false, reason: 'log_failed' });
  apiFetch.mockRejectedValueOnce(new Error('down'));
  expect(await updateDiagnosisLeadApi({ leadId: 'l', change: 'contacted' })).toEqual({ ok: false, reason: 'failed' });
});

test('상세: 성공 때만 detail을 돌려주고, 실패 결과에는 detail이 없다', async () => {
  apiFetch.mockResolvedValueOnce(ok({ result: 'ok', id: 'r', respondentName: '이름' }));
  expect(await getDiagnosisResultDetailApi('r')).toMatchObject({ ok: true, detail: { id: 'r', respondentName: '이름' } });
  apiFetch.mockResolvedValueOnce({ ok: false, status: 503, error: { code: 'unavailable', message: 'log_failed' } });
  expect(await getDiagnosisResultDetailApi('r')).toEqual({ ok: false, reason: 'log_failed' });
  apiFetch.mockResolvedValueOnce(ok({ result: 'not_found' }));
  expect(await getDiagnosisResultDetailApi('r')).toEqual({ ok: false, reason: 'not_found' });
  apiFetch.mockResolvedValueOnce(ok({ result: 'forbidden' }));
  expect(await getDiagnosisResultDetailApi('r')).toEqual({ ok: false, reason: 'forbidden' });
  apiFetch.mockResolvedValueOnce({ ok: false, status: 401, error: { code: 'unauthenticated', message: 'x' } });
  expect(await getDiagnosisResultDetailApi('r')).toEqual({ ok: false, reason: 'unauthenticated' });
  apiFetch.mockRejectedValueOnce(new Error('down'));
  expect(await getDiagnosisResultDetailApi('r')).toEqual({ ok: false, reason: 'failed' });
});

test('목록(C4): admin.listDiagnosisResults를 params로 부르고, 가린 행을 그대로 돌려준다', async () => {
  const { listDiagnosisResultsApi } = await import('@/lib/db/admin-diagnosis');
  const rows = [{ id: 'r', createdAt: 'x', respondentName: '홍**', phone: '010-****-5678', email: 'ab***@d.kr', isRevealed: false, learningExperience: 'none', totalScore: 1, recommendedTier: 'level1', userId: null }];
  apiFetch.mockResolvedValueOnce(ok({ result: 'ok', rows }));
  expect(await listDiagnosisResultsApi({ tier: 'level1', memberOnly: 'all' })).toEqual({ ok: true, rows });
  expect(apiFetch).toHaveBeenCalledWith('/v1/op/admin.listDiagnosisResults', { method: 'POST', session: 'tok', body: { params: { tier: 'level1', memberOnly: 'all' } } });
  apiFetch.mockResolvedValueOnce(ok({ result: 'ok', rows }));
  await listDiagnosisResultsApi({ revealId: 'r' });
  expect(apiFetch.mock.calls[1][1].body).toEqual({ params: { revealId: 'r' } });
  apiFetch.mockResolvedValueOnce(ok({ result: 'forbidden' }));
  expect(await listDiagnosisResultsApi({})).toEqual({ ok: false, reason: 'forbidden' });
  apiFetch.mockResolvedValueOnce({ ok: false, status: 503, error: { code: 'unavailable', message: 'log_failed' } });
  expect(await listDiagnosisResultsApi({ revealId: 'r' })).toEqual({ ok: false, reason: 'log_failed' });
  apiFetch.mockResolvedValueOnce({ ok: false, status: 401, error: { code: 'unauthenticated', message: 'x' } });
  expect(await listDiagnosisResultsApi({})).toEqual({ ok: false, reason: 'unauthenticated' });
  apiFetch.mockResolvedValueOnce({ ok: false, status: 400, error: { code: 'validation', message: 'x' } });
  expect(await listDiagnosisResultsApi({})).toEqual({ ok: false, reason: 'failed' });
  apiFetch.mockRejectedValueOnce(new Error('down'));
  expect(await listDiagnosisResultsApi({})).toEqual({ ok: false, reason: 'failed' });
});
