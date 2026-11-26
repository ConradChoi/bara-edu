import { beforeEach, expect, test, vi } from 'vitest';
import { DIAGNOSIS_QUESTIONS } from '@/data/diagnosis/questions';
import { CURRENT_SENSITIVE_CONSENT_VERSION } from '@/data/diagnosis/consent';

type Res = { ok: true; data: unknown } | { ok: false; status: number; error: Record<string, string> };
const apiFetch = vi.fn<(p: string, i: { body?: { args?: Record<string, unknown> }; session?: string | null }) => Promise<Res>>();
vi.mock('@/lib/db/api', () => ({ apiFetch: (p: string, i: never) => apiFetch(p, i) }));
vi.mock('@/lib/db/session-cookie', () => ({ readSession: async () => 'tok' }));
vi.mock('@/lib/supabase/queries', () => ({ getLegalDocument: async () => ({ version: 10 }) }));
const cookieSet = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: cookieSet }), headers: async () => ({ get: () => null }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { deleteMyDiagnosisResult, submitDiagnosis } from '@/app/actions/diagnosis';

beforeEach(() => {
  apiFetch.mockReset();
  cookieSet.mockReset();
});

function validForm(overrides: Record<string, string | null> = {}): FormData {
  const base: Record<string, string | null> = {
    name: '홍길동',
    phone: '',
    email: 'a@b.kr',
    learningExperience: 'none',
    consentPrivacy: 'on',
    consentSensitive: 'on',
    consentSensitiveVersion: CURRENT_SENSITIVE_CONSENT_VERSION,
    ageConfirmed: 'on',
    ...Object.fromEntries(DIAGNOSIS_QUESTIONS.map((q) => [q.code, '3'])),
    ...overrides,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(base)) if (v !== null) fd.set(k, v);
  return fd;
}
const run = (fd: FormData) => submitDiagnosis(fd).then(() => 'NO_REDIRECT', (e: Error) => e.message);
const apiErr = (status: number, error: Record<string, string>): Res => ({ ok: false, status, error: { message: 'm', ...error } });

test('정상 제출: 민감정보 동의와 고정 버전(sc-v1)을 보내고 결과로 이동', async () => {
  apiFetch.mockResolvedValueOnce({ ok: true, data: { data: [{ access_token: 'TOKEN' }] } });
  expect(await run(validForm())).toBe('REDIRECT:/selfcheck/result/TOKEN');
  const args = apiFetch.mock.calls[0][1].body!.args!;
  expect(args.p_consent_sensitive).toBe(true);
  expect(args.p_consent_sensitive_version).toBe('sc-v1');
  expect(args.p_consent_sensitive_version).toBe(CURRENT_SENSITIVE_CONSENT_VERSION);
  expect(args.p_consent_privacy).toBe(true);
  expect(args.p_consent_privacy_doc_version).toBe(10);
  expect(cookieSet).toHaveBeenCalledWith('bara_selfcheck_recent_token', 'TOKEN', expect.objectContaining({ httpOnly: true }));
});

test('앱이 먼저 막는다: 개인정보 → 민감정보 → 버전 순서, API를 부르지 않는다', async () => {
  expect(await run(validForm({ consentPrivacy: null, consentSensitive: null }))).toBe('REDIRECT:/selfcheck/start?error=consent-required&consent=privacy');
  expect(await run(validForm({ consentSensitive: null }))).toBe('REDIRECT:/selfcheck/start?error=consent-required&consent=sensitive');
  expect(await run(validForm({ consentSensitive: 'yes' }))).toBe('REDIRECT:/selfcheck/start?error=consent-required&consent=sensitive');
  expect(await run(validForm({ consentSensitiveVersion: 'sc-v0' }))).toBe('REDIRECT:/selfcheck/start?error=consent-outdated');
  expect(await run(validForm({ consentSensitiveVersion: null }))).toBe('REDIRECT:/selfcheck/start?error=consent-outdated');
  expect(await run(validForm({ ageConfirmed: null }))).toBe('REDIRECT:/selfcheck/start?error=validation');
  expect(await run(validForm({ name: '' }))).toBe('REDIRECT:/selfcheck/start?error=validation');
  expect(await run(validForm({ A1: null }))).toBe('REDIRECT:/selfcheck/start?error=incomplete');
  expect(apiFetch).not.toHaveBeenCalled();
});

// API 계약 C1의 서버 오류 → 화면 코드
test.each([
  [apiErr(400, { code: 'validation', field: 'consent', reason: 'privacy' }), '/selfcheck/start?error=consent-required&consent=privacy'],
  [apiErr(400, { code: 'validation', field: 'consent', reason: 'sensitive' }), '/selfcheck/start?error=consent-required&consent=sensitive'],
  [apiErr(400, { code: 'validation', field: 'consent' }), '/selfcheck/start?error=consent-required'],
  [apiErr(400, { code: 'validation', field: 'consent_version' }), '/selfcheck/start?error=consent-outdated'],
  [apiErr(400, { code: 'validation' }), '/selfcheck/start?error=submit-failed'],
  [apiErr(400, { code: 'db_error', sqlstate: 'P0001' }), '/selfcheck/start?error=submit-failed'],
  [apiErr(503, { code: 'unavailable' }), '/selfcheck/start?error=submit-failed'],
])('서버 오류 매핑 → %#', async (res, to) => {
  apiFetch.mockResolvedValueOnce(res);
  expect(await run(validForm())).toBe(`REDIRECT:${to}`);
  expect(cookieSet).not.toHaveBeenCalled();
});

test('지우기: 성공·실패·로그인 필요, 문의 함께 지우기 체크 전달', async () => {
  const fd = new FormData();
  fd.set('deleteLeads', 'on');
  apiFetch.mockResolvedValueOnce({ ok: true, data: { data: true } });
  await expect(deleteMyDiagnosisResult('TOK', fd)).rejects.toThrow('REDIRECT:/my?tab=diagnosis&deleted=1');
  expect(apiFetch.mock.calls[0][1].body!.args).toEqual({ p_token: 'TOK', p_delete_leads: true });

  apiFetch.mockResolvedValueOnce({ ok: true, data: { data: false } });
  await expect(deleteMyDiagnosisResult('TOK', new FormData())).rejects.toThrow('REDIRECT:/my?tab=diagnosis&deleteError=1');
  expect(apiFetch.mock.calls[1][1].body!.args).toEqual({ p_token: 'TOK', p_delete_leads: false });

  apiFetch.mockResolvedValueOnce(apiErr(401, { code: 'unauthenticated' }));
  await expect(deleteMyDiagnosisResult('TOK', new FormData())).rejects.toThrow(`REDIRECT:/sign-in?redirect=${encodeURIComponent('/my?tab=diagnosis')}`);

  apiFetch.mockResolvedValueOnce(apiErr(500, { code: 'internal' }));
  await expect(deleteMyDiagnosisResult('TOK', new FormData())).rejects.toThrow('REDIRECT:/my?tab=diagnosis&deleteError=1');
});
