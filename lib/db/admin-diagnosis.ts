import 'server-only';
import { apiFetch } from './api';
import { readSession } from './session-cookie';

// 관리자 도형심리 진단 기능의 API 연동. 접속 기록은 API가 같은 트랜잭션에서 남긴다 — 앱이 logAdminAccess를 따로 부르지 않는다.
// 기록이 실패하면 API가 503(log_failed)로 롤백하고 원문 없이 응답한다.

export type LeadChange = { leadId: string; change: 'contacted' } | { leadId: string; change: 'closed'; fromStatus: 'new' | 'contacted' } | { leadId: string; change: 'note' };

export type UpdateLeadResult =
  | { ok: true; unchanged: boolean }
  | { ok: false; reason: 'already_processed' | 'reason_required' | 'memo_has_pii' | 'not_found' | 'forbidden' | 'unauthenticated' | 'log_failed' | 'failed' };

export async function updateDiagnosisLeadApi(input: LeadChange & { note?: string | null }): Promise<UpdateLeadResult> {
  try {
    const r = await apiFetch<{ data: { result: string; reason?: string } }>('/v1/op/admin.updateDiagnosisLead', { method: 'POST', session: await readSession(), body: { params: input } });
    if (!r.ok) {
      if (r.status === 401 && r.error.code === 'unauthenticated') return { ok: false, reason: 'unauthenticated' };
      if (r.status === 503 && r.error.message === 'log_failed') return { ok: false, reason: 'log_failed' };
      return { ok: false, reason: 'failed' };
    }
    const d = r.data.data;
    if (d.result === 'ok') return { ok: true, unchanged: false };
    if (d.result === 'unchanged') return { ok: true, unchanged: true };
    if (d.result === 'already_processed' || d.result === 'not_found' || d.result === 'forbidden') return { ok: false, reason: d.result };
    if (d.result === 'validation') return { ok: false, reason: d.reason === 'memo_has_pii' ? 'memo_has_pii' : d.reason === 'reason_required' ? 'reason_required' : 'failed' };
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export type DiagnosisResultDetail = {
  id: string;
  createdAt: string;
  respondentName: string | null;
  phone: string | null;
  email: string | null;
  learningExperience: string;
  totalScore: number;
  recommendedTier: string;
  userId: string | null;
  scoreTheory: number;
  scoreReading: number;
  scoreAnalysis: number;
  scoreCounseling: number;
  scoreCaseRecord: number;
  scoreTeaching: number;
  strengthAreas: string[];
  improvementAreas: string[];
  answers: { itemCode: string; score: number }[];
  // 동의 기록(API 계약 C5). 정리 스크립트 뒤에는 민감정보 동의 두 값이 항상 있다.
  sensitiveConsentVersion: string | null;
  sensitiveConsentedAt: string | null;
  privacyDocVersion: number | null;
};

export type DiagnosisDetailResult =
  | { ok: true; detail: DiagnosisResultDetail }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'unauthenticated' | 'log_failed' | 'failed' };

// 접속 기록이 남은 경우에만 원문을 돌려준다(API가 한 트랜잭션으로 보장). 실패 결과에는 원문이 없다.
export async function getDiagnosisResultDetailApi(id: string): Promise<DiagnosisDetailResult> {
  try {
    const r = await apiFetch<{ data: { result: string } & Partial<DiagnosisResultDetail> }>('/v1/op/admin.getDiagnosisResultDetail', { method: 'POST', session: await readSession(), body: { params: { id } } });
    if (!r.ok) {
      if (r.status === 401 && r.error.code === 'unauthenticated') return { ok: false, reason: 'unauthenticated' };
      if (r.status === 503 && r.error.message === 'log_failed') return { ok: false, reason: 'log_failed' };
      return { ok: false, reason: 'failed' };
    }
    const { result, ...rest } = r.data.data;
    if (result === 'ok') return { ok: true, detail: rest as DiagnosisResultDetail };
    if (result === 'not_found' || result === 'forbidden') return { ok: false, reason: result };
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

// ---------------- 진단 결과 목록(API 계약 C4) ----------------
// 이름·연락처는 API가 가려서 내려 준다(앱 서버에도 원문이 오지 않는다). revealId 한 행만 원문이고, 그 접속 기록은
// API가 같은 트랜잭션에서 남긴다. revealId는 호출부가 reveal 토큰(HMAC)을 검증한 뒤에만 넘긴다.

export const DIAGNOSIS_LIST_TIERS = ['all', 'level2', 'level1', 'supervision', 'instructor_candidate'] as const;
export type DiagnosisListTier = (typeof DIAGNOSIS_LIST_TIERS)[number];
export type DiagnosisListMemberFilter = 'all' | 'member' | 'non_member';

export type AdminDiagnosisResultRow = {
  id: string;
  createdAt: string;
  respondentName: string; // 가린 값(홍**) 또는 revealId 행이면 원문. 값 없음은 '-'
  phone: string;
  email: string;
  isRevealed: boolean;
  learningExperience: string;
  totalScore: number;
  recommendedTier: string;
  userId: string | null;
};

export type ListDiagnosisResultsResult =
  | { ok: true; rows: AdminDiagnosisResultRow[] }
  | { ok: false; reason: 'forbidden' | 'unauthenticated' | 'log_failed' | 'failed' };

export async function listDiagnosisResultsApi(params: { tier?: DiagnosisListTier; memberOnly?: DiagnosisListMemberFilter; revealId?: string }): Promise<ListDiagnosisResultsResult> {
  try {
    const body: Record<string, string> = {};
    if (params.tier) body.tier = params.tier;
    if (params.memberOnly) body.memberOnly = params.memberOnly;
    if (params.revealId) body.revealId = params.revealId;
    const r = await apiFetch<{ data: { result: string; rows?: AdminDiagnosisResultRow[] } }>('/v1/op/admin.listDiagnosisResults', {
      method: 'POST',
      session: await readSession(),
      body: { params: body },
    });
    if (!r.ok) {
      if (r.status === 401 && r.error.code === 'unauthenticated') return { ok: false, reason: 'unauthenticated' };
      if (r.status === 503 && r.error.message === 'log_failed') return { ok: false, reason: 'log_failed' };
      return { ok: false, reason: 'failed' };
    }
    const d = r.data.data;
    if (d.result === 'ok' && Array.isArray(d.rows)) return { ok: true, rows: d.rows };
    if (d.result === 'forbidden') return { ok: false, reason: 'forbidden' };
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

// ---------------- 강사과정 문의 목록(2026-11-27) ----------------
// diagnosis_leads 직접 select(관리자 select 정책)를 없애고 이 op로 읽는다. 규칙은 진단 결과 목록과 같다:
// 이름·연락처는 API가 가려서 내려 주고, revealId 한 행만 원문 + API가 같은 트랜잭션에서 접속 기록.

export const DIAGNOSIS_LEAD_STATUSES = ['all', 'new', 'contacted', 'closed'] as const;
export type DiagnosisLeadStatusFilter = (typeof DIAGNOSIS_LEAD_STATUSES)[number];

export type AdminDiagnosisLeadRow = {
  id: string;
  createdAt: string;
  resultId: string | null;
  name: string; // 가린 값(홍**) 또는 revealId 행이면 원문
  contact: string;
  isRevealed: boolean;
  message: string | null;
  status: string;
  adminNote: string | null;
  handledAt: string | null;
  userId: string | null;
};

export type ListDiagnosisLeadsResult =
  | { ok: true; rows: AdminDiagnosisLeadRow[] }
  | { ok: false; reason: 'forbidden' | 'unauthenticated' | 'log_failed' | 'failed' };

export async function listDiagnosisLeadsApi(params: { status?: DiagnosisLeadStatusFilter; revealId?: string }): Promise<ListDiagnosisLeadsResult> {
  try {
    const body: Record<string, string> = {};
    if (params.status) body.status = params.status;
    if (params.revealId) body.revealId = params.revealId;
    const r = await apiFetch<{ data: { result: string; rows?: AdminDiagnosisLeadRow[] } }>('/v1/op/admin.listDiagnosisLeads', {
      method: 'POST',
      session: await readSession(),
      body: { params: body },
    });
    if (!r.ok) {
      if (r.status === 401 && r.error.code === 'unauthenticated') return { ok: false, reason: 'unauthenticated' };
      if (r.status === 503 && r.error.message === 'log_failed') return { ok: false, reason: 'log_failed' };
      return { ok: false, reason: 'failed' };
    }
    const d = r.data.data;
    if (d.result === 'ok' && Array.isArray(d.rows)) return { ok: true, rows: d.rows };
    if (d.result === 'forbidden') return { ok: false, reason: 'forbidden' };
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
