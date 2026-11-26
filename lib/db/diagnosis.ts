import 'server-only';
import { apiFetch } from './api';
import { readSession } from './session-cookie';

// 도형심리 자가진단 학습자·비회원 쪽 API 연동 중 오류 필드(field·reason)를 구분해야 하는 두 경로.
// 계약: docs/02-design/features/bara-edu-lms.diagnosis-sensitive-consent.md "API 계약" C1·C2.
// createClient().rpc()는 오류를 { code, message }로 줄여 field를 잃으므로 apiFetch를 직접 쓴다.

export type SubmitDiagnosisArgs = {
  p_name: string;
  p_phone: string | null;
  p_email: string | null;
  p_learning_experience: string;
  p_certificate_level: string | null;
  p_consent_privacy: boolean;
  p_consent_privacy_doc_version: number | null;
  p_consent_sensitive: boolean;
  p_consent_sensitive_version: string;
  p_age_confirmed: boolean;
  p_answers: Record<string, number>;
};

// 화면 코드(/selfcheck/start?error=)와 1:1. consent는 어느 체크박스에 포커스를 줄지 고를 때만 쓴다.
export type SubmitDiagnosisResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: 'consent-required'; consent: 'privacy' | 'sensitive' | null }
  | { ok: false; error: 'consent-outdated' }
  | { ok: false; error: 'submit-failed' };

export async function submitDiagnosisApi(args: SubmitDiagnosisArgs): Promise<SubmitDiagnosisResult> {
  try {
    const r = await apiFetch<{ data: { access_token?: unknown }[] }>('/v1/rpc/submit_diagnosis', { method: 'POST', session: await readSession(), body: { args } });
    if (!r.ok) {
      // C1 순서 1·2: 동의 없음(400 validation field=consent, reason=privacy|sensitive)
      if (r.status === 400 && r.error.code === 'validation' && r.error.field === 'consent') {
        const consent = r.error.reason === 'privacy' || r.error.reason === 'sensitive' ? r.error.reason : null;
        return { ok: false, error: 'consent-required', consent };
      }
      // C1 순서 3: 동의 문구 버전이 허용 목록에 없음
      if (r.status === 400 && r.error.code === 'validation' && r.error.field === 'consent_version') return { ok: false, error: 'consent-outdated' };
      // C1 순서 0(인자 형식), 4~(만 14세·이름·연락처·문항·5분 중복 db_error), 401·5xx·연결 실패는 기존대로 submit-failed
      return { ok: false, error: 'submit-failed' };
    }
    const row = Array.isArray(r.data?.data) ? r.data.data[0] : undefined;
    const token = row?.access_token;
    if (typeof token !== 'string' || !token) return { ok: false, error: 'submit-failed' };
    return { ok: true, accessToken: token };
  } catch {
    return { ok: false, error: 'submit-failed' };
  }
}

export type DeleteMyDiagnosisResult = { ok: true } | { ok: false; reason: 'unauthenticated' | 'failed' };

// C2. true만 성공. false(없음·이미 지움·남의 결과)와 오류는 구분하지 않고 실패로 본다(정의서 11.3).
export async function deleteMyDiagnosisResultApi(token: string, deleteLeads: boolean): Promise<DeleteMyDiagnosisResult> {
  try {
    const r = await apiFetch<{ data: unknown }>('/v1/rpc/delete_my_diagnosis_result', {
      method: 'POST',
      session: await readSession(),
      body: { args: { p_token: token, p_delete_leads: deleteLeads } },
    });
    if (!r.ok) return { ok: false, reason: r.status === 401 && r.error.code === 'unauthenticated' ? 'unauthenticated' : 'failed' };
    return r.data?.data === true ? { ok: true } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
