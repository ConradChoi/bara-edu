import { beforeEach, expect, test, vi } from 'vitest';

type Res = { ok: true; data: unknown } | { ok: false; status: number; error: { code: string; message: string; field?: string; reason?: string; sqlstate?: string } };
const apiFetch = vi.fn<(p: string, i: { body?: unknown; session?: string | null }) => Promise<Res>>();
vi.mock('@/lib/db/api', () => ({ apiFetch: (p: string, i: never) => apiFetch(p, i) }));
vi.mock('@/lib/db/session-cookie', () => ({ readSession: async () => 'tok' }));

import { deleteMyDiagnosisResultApi, submitDiagnosisApi, type SubmitDiagnosisArgs } from '@/lib/db/diagnosis';

beforeEach(() => apiFetch.mockReset());

const ARGS: SubmitDiagnosisArgs = {
  p_name: '홍길동', p_phone: null, p_email: 'a@b.kr', p_learning_experience: 'none', p_certificate_level: null,
  p_consent_privacy: true, p_consent_privacy_doc_version: 10, p_consent_sensitive: true, p_consent_sensitive_version: 'sc-v1',
  p_age_confirmed: true, p_answers: { A1: 4 },
};
const err = (status: number, e: Record<string, string>): Res => ({ ok: false, status, error: { message: 'm', ...e } as never });

test('제출: 세션과 args로 submit_diagnosis를 부르고 토큰을 돌려준다', async () => {
  apiFetch.mockResolvedValueOnce({ ok: true, data: { data: [{ access_token: 'T', recommended_tier: 'level1', total_score: 50 }] } });
  expect(await submitDiagnosisApi(ARGS)).toEqual({ ok: true, accessToken: 'T' });
  expect(apiFetch).toHaveBeenCalledWith('/v1/rpc/submit_diagnosis', { method: 'POST', session: 'tok', body: { args: ARGS } });
});

// API 계약 C1의 오류 표, 한 줄씩
test.each([
  ['0: 인자 누락·형식 오류(field 없음)', err(400, { code: 'validation' }), { ok: false, error: 'submit-failed' }],
  ['1: 개인정보 동의 없음', err(400, { code: 'validation', field: 'consent', reason: 'privacy' }), { ok: false, error: 'consent-required', consent: 'privacy' }],
  ['2: 민감정보 동의 없음', err(400, { code: 'validation', field: 'consent', reason: 'sensitive' }), { ok: false, error: 'consent-required', consent: 'sensitive' }],
  ['1·2: reason을 모름', err(400, { code: 'validation', field: 'consent', reason: 'x' }), { ok: false, error: 'consent-required', consent: null }],
  ['3: 동의 문구 버전 불일치', err(400, { code: 'validation', field: 'consent_version' }), { ok: false, error: 'consent-outdated' }],
  ['4~: 기존 검사(db_error P0001)', err(400, { code: 'db_error', sqlstate: 'P0001' }), { ok: false, error: 'submit-failed' }],
  ['다른 칸 validation', err(400, { code: 'validation', field: 'name' }), { ok: false, error: 'submit-failed' }],
  ['503 연결 불가', err(503, { code: 'unavailable' }), { ok: false, error: 'submit-failed' }],
  ['200인데 행 없음', { ok: true, data: { data: [] } } as Res, { ok: false, error: 'submit-failed' }],
])('제출 오류 매핑 %s', async (_name, res, expected) => {
  apiFetch.mockResolvedValueOnce(res);
  expect(await submitDiagnosisApi(ARGS)).toEqual(expected);
});

test('제출: 예외(네트워크)도 submit-failed', async () => {
  apiFetch.mockRejectedValueOnce(new Error('down'));
  expect(await submitDiagnosisApi(ARGS)).toEqual({ ok: false, error: 'submit-failed' });
});

test('지우기: true만 성공, false·오류는 구분 없이 실패, 401은 로그인 필요', async () => {
  apiFetch.mockResolvedValueOnce({ ok: true, data: { data: true } });
  expect(await deleteMyDiagnosisResultApi('tok-1', true)).toEqual({ ok: true });
  expect(apiFetch).toHaveBeenCalledWith('/v1/rpc/delete_my_diagnosis_result', { method: 'POST', session: 'tok', body: { args: { p_token: 'tok-1', p_delete_leads: true } } });
  apiFetch.mockResolvedValueOnce({ ok: true, data: { data: false } });
  expect(await deleteMyDiagnosisResultApi('tok-1', false)).toEqual({ ok: false, reason: 'failed' });
  apiFetch.mockResolvedValueOnce(err(401, { code: 'unauthenticated' }));
  expect(await deleteMyDiagnosisResultApi('tok-1', false)).toEqual({ ok: false, reason: 'unauthenticated' });
  apiFetch.mockResolvedValueOnce(err(400, { code: 'validation' }));
  expect(await deleteMyDiagnosisResultApi('bad', false)).toEqual({ ok: false, reason: 'failed' });
  apiFetch.mockRejectedValueOnce(new Error('down'));
  expect(await deleteMyDiagnosisResultApi('tok-1', false)).toEqual({ ok: false, reason: 'failed' });
});
