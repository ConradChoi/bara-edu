import 'server-only';
import { apiFetch } from './api';
import { readSession } from './session-cookie';

// 관리자 회원 상세의 이름·연락처 수정. 계약: docs/02-design/features/bara-edu-lms.admin-profile-edit.api.md
// 접속 기록(action '정보수정')은 API가 같은 트랜잭션에서 남긴다 — 앱이 logAdminAccess를 따로 부르지 않는다.

export type EditReason = 'member_request' | 'typo_fix' | 'signup_attempt_value' | 'other';
export type ProfileValues = { name: string; phone: string | null };

export type UpdateMemberProfileInput = {
  memberId: string;
  // 보낸 필드만 바꾼다. phone: null 또는 빈 문자열은 연락처 비우기
  name?: string;
  phone?: string | null;
  // 편집을 연 시점의 값(보낸 필드 전부). 현재 값과 다르면 stale
  expected: { name?: string; phone?: string | null };
  reason: EditReason;
  memo?: string | null;
  identityChecked: true;
};

export type UpdateMemberProfileResult =
  | { ok: true; unchanged: false; changed: ('name' | 'phone')[]; profile: ProfileValues; mailQueued: boolean }
  | { ok: true; unchanged: true; changed: []; profile: ProfileValues }
  | { ok: false; reason: 'stale'; current: ProfileValues }
  | { ok: false; reason: 'validation'; field?: string; code?: string }
  | { ok: false; reason: 'withdrawn' | 'not_confirmed' | 'target_is_admin' | 'no_email' | 'not_found' | 'forbidden' | 'unauthenticated' | 'log_failed' | 'failed' };

type Data = {
  result: string;
  changed?: ('name' | 'phone')[];
  profile?: ProfileValues;
  mailQueued?: boolean;
  current?: ProfileValues;
  field?: string;
  reason?: string;
};

const REJECTS = ['withdrawn', 'not_confirmed', 'target_is_admin', 'no_email', 'not_found', 'forbidden'] as const;

export async function updateMemberProfileApi(input: UpdateMemberProfileInput): Promise<UpdateMemberProfileResult> {
  try {
    const r = await apiFetch<{ data: Data }>('/v1/op/admin.updateMemberProfile', { method: 'POST', session: await readSession(), body: { params: input } });
    if (!r.ok) {
      if (r.status === 401 && r.error.code === 'unauthenticated') return { ok: false, reason: 'unauthenticated' };
      if (r.status === 503 && r.error.message === 'log_failed') return { ok: false, reason: 'log_failed' };
      if (r.status === 400) return { ok: false, reason: 'validation' };
      return { ok: false, reason: 'failed' };
    }
    const d = r.data.data;
    if (d.result === 'ok' && d.profile) return { ok: true, unchanged: false, changed: d.changed ?? [], profile: d.profile, mailQueued: d.mailQueued === true };
    if (d.result === 'unchanged' && d.profile) return { ok: true, unchanged: true, changed: [], profile: d.profile };
    if (d.result === 'stale' && d.current) return { ok: false, reason: 'stale', current: d.current };
    if (d.result === 'validation') return { ok: false, reason: 'validation', ...(d.field ? { field: d.field } : {}), ...(d.reason ? { code: d.reason } : {}) };
    const reject = REJECTS.find((x) => x === d.result);
    return { ok: false, reason: reject ?? 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export type ProfileEditItem = { at: string; adminName: string | null; fields: string[]; reason: string | null; memo: string | null };
export type ListProfileEditsResult = { ok: true; items: ProfileEditItem[]; hasMore: boolean } | { ok: false; reason: 'forbidden' | 'unauthenticated' | 'failed' };

// 최근 수정 이력(값 없음). limit 기본 5
export async function listMemberProfileEditsApi(memberId: string, limit = 5): Promise<ListProfileEditsResult> {
  try {
    const r = await apiFetch<{ data: { result: string; items?: ProfileEditItem[]; hasMore?: boolean } }>('/v1/op/admin.listMemberProfileEdits', {
      method: 'POST',
      session: await readSession(),
      body: { params: { memberId, limit } },
    });
    if (!r.ok) return { ok: false, reason: r.status === 401 && r.error.code === 'unauthenticated' ? 'unauthenticated' : 'failed' };
    const d = r.data.data;
    if (d.result === 'ok') return { ok: true, items: d.items ?? [], hasMore: d.hasMore === true };
    return { ok: false, reason: d.result === 'forbidden' ? 'forbidden' : 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
