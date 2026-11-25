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
