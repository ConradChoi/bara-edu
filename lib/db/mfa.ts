import 'server-only';
import { cache } from 'react';
import { apiFetch, type ApiResult } from './api';
import { clearMfaChallenge, readSession, writeSession } from './session-cookie';

// 관리자 2단계 인증 API 래퍼. 계약: docs/02-design/features/bara-edu-lms.admin-totp.md 4장(4.11 구현 결정 포함).
// 비밀 값(대기표·6자리·복구 코드·등록 코드·secretBase32·otpauthUri)은 본문으로만 주고받고, 로그·오류 추적에 넘기지 않는다.
// API는 기존 code 값만 쓰고 앱은 message로 분기한다(4.0) — 아래 toMfaFailure가 그 표다.

export type MfaFailReason =
  | 'wrong_code'
  | 'code_reused'
  | 'challenge_invalid'
  | 'challenge_exhausted'
  | 'account_changed'
  | 'mfa_locked'
  | 'rate_limited'
  | 'ticket_invalid'
  | 'ticket_unusable'
  | 'ticket_not_verified'
  | 'enrollment_expired'
  | 'no_enrollment'
  | 'already_enrolled'
  | 'ticket_required'
  | 'not_enrolled'
  | 'not_admin'
  | 'self_reset'
  | 'target_not_admin'
  | 'target_withdrawn'
  | 'mfa_session_required'
  | 'log_failed'
  | 'not_found'
  | 'unauthenticated'
  | 'validation'
  | 'unavailable'
  // 2단계 인증 이전의 API(경로 없음 404). 배포 순서가 앱 → DB → API라 한동안 이 상태가 정상이다(7.1).
  | 'unsupported'
  | 'failed';

export type MfaFailure = {
  ok: false;
  reason: MfaFailReason;
  attemptsLeft?: number;
  lockScope?: 'account' | 'daily';
  retryAfterMinutes?: number;
  ticketVerified?: boolean;
  field?: string;
};

const BY_MESSAGE: Record<number, readonly MfaFailReason[]> = {
  401: ['challenge_invalid', 'challenge_exhausted', 'account_changed'],
  403: ['wrong_code', 'code_reused', 'ticket_invalid', 'ticket_not_verified', 'not_admin', 'mfa_session_required'],
  404: ['no_enrollment', 'not_found'],
  409: ['ticket_unusable', 'enrollment_expired', 'already_enrolled', 'ticket_required', 'not_enrolled', 'self_reset', 'target_not_admin', 'target_withdrawn'],
};

export function toMfaFailure(r: ApiResult<unknown>): MfaFailure {
  if (r.ok) return { ok: false, reason: 'failed' };
  const { status, error: e } = r;
  const extras = {
    ...(typeof e.attemptsLeft === 'number' ? { attemptsLeft: e.attemptsLeft } : {}),
    ...(typeof e.ticketVerified === 'boolean' ? { ticketVerified: e.ticketVerified } : {}),
  };
  const known = (BY_MESSAGE[status] ?? []).find((m) => m === e.message);
  if (status === 401) {
    // 서비스 키 오류(unauthorized_service)는 사용자의 상태가 아니다
    if (e.code !== 'unauthenticated') return { ok: false, reason: 'failed' };
    // 대기표 문제가 아니면 세션 없음(D-10: '로그인이 필요합니다.') 또는 세션 만료(session_expired)
    return { ok: false, reason: known ?? 'unauthenticated' };
  }
  if (status === 403) return { ok: false, reason: known ?? 'not_admin', ...extras };
  if (status === 404) return { ok: false, reason: known ?? 'unsupported', ...extras };
  if (status === 409) return { ok: false, reason: known ?? 'failed' };
  if (status === 429) {
    if (e.message !== 'mfa_locked') return { ok: false, reason: 'rate_limited' };
    return {
      ok: false,
      reason: 'mfa_locked',
      lockScope: e.lockScope === 'daily' ? 'daily' : 'account',
      retryAfterMinutes: typeof e.retryAfterMinutes === 'number' && e.retryAfterMinutes > 0 ? Math.ceil(e.retryAfterMinutes) : 15,
    };
  }
  if (status === 400) return { ok: false, reason: 'validation', ...(e.field ? { field: e.field } : {}) };
  if (status === 503) return { ok: false, reason: e.message === 'log_failed' ? 'log_failed' : 'unavailable' };
  return { ok: false, reason: 'failed' };
}

type SessionBody = { sessionToken: string; expiresAt: string; userId: string };

function isSessionBody(d: unknown): d is SessionBody {
  const b = d as Partial<SessionBody> | null;
  return !!b && typeof b.sessionToken === 'string' && typeof b.expiresAt === 'string' && typeof b.userId === 'string';
}

// 2단계를 통과해 받은 세션: 대기표 쿠키를 지우고 세션 쿠키를 쓴다(기획서 2.2 "2단계 성공").
async function adoptSession(s: SessionBody): Promise<void> {
  await writeSession(s.sessionToken, s.expiresAt);
  await clearMfaChallenge();
}

const post = <T>(path: string, body: unknown, session?: string | null) => apiFetch<T>(path, { method: 'POST', body, ...(session !== undefined ? { session } : {}) });

// ---- 4.2 / 4.3 로그인 2단계 ----

export type SessionIssued = { ok: true; userId: string };

export async function verifyMfa(challengeToken: string, code: string): Promise<SessionIssued | MfaFailure> {
  const r = await post<SessionBody>('/v1/auth/mfa/verify', { challengeToken, code });
  if (!r.ok) return toMfaFailure(r);
  if (!isSessionBody(r.data)) return { ok: false, reason: 'failed' };
  await adoptSession(r.data);
  return { ok: true, userId: r.data.userId };
}

export async function recoverMfa(challengeToken: string, recoveryCode: string): Promise<(SessionIssued & { recoveryCodesLeft: number }) | MfaFailure> {
  const r = await post<SessionBody & { recoveryCodesLeft: number }>('/v1/auth/mfa/recover', { challengeToken, recoveryCode });
  if (!r.ok) return toMfaFailure(r);
  if (!isSessionBody(r.data)) return { ok: false, reason: 'failed' };
  await adoptSession(r.data);
  return { ok: true, userId: r.data.userId, recoveryCodesLeft: typeof r.data.recoveryCodesLeft === 'number' ? r.data.recoveryCodesLeft : 0 };
}

// ---- 4.4 등록 ----

export type Enrollment = { enrollmentId: string; otpauthUri: string; secretBase32: string; expiresAt: string; entry: 'A' | 'B' | 'C' };

function asEnrollment(d: unknown): Enrollment | null {
  const e = d as Partial<Enrollment> | null;
  if (!e || typeof e.enrollmentId !== 'string' || typeof e.otpauthUri !== 'string' || typeof e.secretBase32 !== 'string') return null;
  if (!e.otpauthUri.startsWith('otpauth://totp/')) return null;
  if (e.entry !== 'A' && e.entry !== 'B' && e.entry !== 'C') return null;
  return { enrollmentId: e.enrollmentId, otpauthUri: e.otpauthUri, secretBase32: e.secretBase32, expiresAt: typeof e.expiresAt === 'string' ? e.expiresAt : '', entry: e.entry };
}

export async function checkEnrollTicket(challengeToken: string, enrollTicket: string): Promise<{ ok: true } | MfaFailure> {
  const r = await post('/v1/auth/mfa/enroll/ticket', { challengeToken, enrollTicket });
  return r.ok ? { ok: true } : toMfaFailure(r);
}

// B: 로그인 중(대기표), A: 세션(빈 본문), C: 세션 + 지금 번호 또는 복구 코드 정확히 하나. renew는 [QR 새로 만들기].
// C의 renew는 재확인을 다시 묻는다(D-5) — 그래서 C는 늘 currentCode/recoveryCode와 함께 보낸다.
export type StartEnrollInput =
  | { challenge: string; renew?: boolean }
  | { renew?: boolean }
  | { currentCode: string; renew?: boolean }
  | { recoveryCode: string; renew?: boolean };

export async function startMfaEnroll(input: StartEnrollInput): Promise<{ ok: true; enrollment: Enrollment } | MfaFailure> {
  const body: Record<string, unknown> = {};
  if ('challenge' in input) body.challengeToken = input.challenge;
  if ('currentCode' in input) body.currentCode = input.currentCode;
  if ('recoveryCode' in input) body.recoveryCode = input.recoveryCode;
  if (input.renew) body.renew = true;
  const r = await post('/v1/auth/mfa/enroll/start', body, 'challenge' in input ? undefined : await readSession());
  if (!r.ok) return toMfaFailure(r);
  const enrollment = asEnrollment(r.data);
  return enrollment ? { ok: true, enrollment } : { ok: false, reason: 'failed' };
}

// 새로고침 때 같은 등록 대기를 다시 그린다(새 비밀 키를 만들지 않는다). challenge가 없으면 세션(A·C).
export async function getCurrentEnrollment(challenge?: string): Promise<{ ok: true; enrollment: Enrollment } | MfaFailure> {
  const r = challenge ? await post('/v1/auth/mfa/enroll/current', { challengeToken: challenge }) : await post('/v1/auth/mfa/enroll/current', {}, await readSession());
  if (!r.ok) return toMfaFailure(r);
  const enrollment = asEnrollment(r.data);
  return enrollment ? { ok: true, enrollment } : { ok: false, reason: 'failed' };
}

export type ConfirmEnrollInput = { enrollmentId: string; code: string } & ({ challenge: string } | { rotateRecoveryCodes: boolean });

// A·B는 새 세션을 받는다(A는 기존 세션이 지워진다, 보안 점검 I-2) → 세션 쿠키를 다시 쓴다.
// C는 rotateRecoveryCodes를 늘 명시해서 보낸다(D-6: API 기본값 false).
export async function confirmMfaEnroll(input: ConfirmEnrollInput): Promise<{ ok: true; recoveryCodes: string[] | null; userId: string | null; sessionToken: string | null } | MfaFailure> {
  const body: Record<string, unknown> = { enrollmentId: input.enrollmentId, code: input.code };
  if ('challenge' in input) body.challengeToken = input.challenge;
  else body.rotateRecoveryCodes = input.rotateRecoveryCodes;
  const r = await post<{ recoveryCodes: string[] | null } & Partial<SessionBody>>('/v1/auth/mfa/enroll/confirm', body, 'challenge' in input ? undefined : await readSession());
  if (!r.ok) return toMfaFailure(r);
  const codes = Array.isArray(r.data?.recoveryCodes) ? r.data.recoveryCodes.filter((c): c is string => typeof c === 'string') : null;
  if (isSessionBody(r.data)) {
    await adoptSession(r.data);
    return { ok: true, recoveryCodes: codes, userId: r.data.userId, sessionToken: r.data.sessionToken };
  }
  return { ok: true, recoveryCodes: codes, userId: null, sessionToken: null };
}

// ---- 4.5 로그인 후 ----

export type MfaMode = 'off' | 'optional' | 'enforce';
export type MfaStatus = {
  mode: MfaMode;
  enrolled: boolean;
  enrolledAt: string | null;
  lastUsedAt: string | null;
  recoveryCodesLeft: number;
  recoveryCodesAcked: boolean;
  canSelfEnroll: boolean;
  graceUntil: string | null;
  signedInWithRecovery: boolean;
  sessionExpiresAt: string | null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function asStatus(d: unknown): MfaStatus | null {
  const s = d as Record<string, unknown> | null;
  if (!s || (s.mode !== 'off' && s.mode !== 'optional' && s.mode !== 'enforce') || typeof s.enrolled !== 'boolean') return null;
  return {
    mode: s.mode,
    enrolled: s.enrolled,
    enrolledAt: str(s.enrolledAt),
    lastUsedAt: str(s.lastUsedAt),
    recoveryCodesLeft: typeof s.recoveryCodesLeft === 'number' ? s.recoveryCodesLeft : 0,
    recoveryCodesAcked: s.recoveryCodesAcked !== false,
    canSelfEnroll: s.canSelfEnroll === true,
    graceUntil: str(s.graceUntil),
    signedInWithRecovery: s.signedInWithRecovery === true,
    sessionExpiresAt: str(s.sessionExpiresAt),
  };
}

// 옛 API는 경로가 없어 404 → 'unsupported'. 화면은 "준비 중"으로 두거나 숨긴다(배포 순서 호환).
// 관리자 화면 틀(배너·메뉴)과 페이지가 같은 요청에서 함께 부르므로 렌더 한 번에 한 번만 호출한다(react cache).
export const getMfaStatus = cache(async (): Promise<{ ok: true; status: MfaStatus } | MfaFailure> => {
  const session = await readSession();
  if (!session) return { ok: false, reason: 'unauthenticated' };
  const r = await apiFetch('/v1/auth/mfa/status', { method: 'GET', session });
  if (!r.ok) return toMfaFailure(r);
  const status = asStatus(r.data);
  return status ? { ok: true, status } : { ok: false, reason: 'failed' };
});

export async function regenerateRecoveryCodes(code: string): Promise<{ ok: true; recoveryCodes: string[] } | MfaFailure> {
  const r = await post<{ recoveryCodes: string[] }>('/v1/auth/mfa/recovery-codes', { code }, await readSession());
  if (!r.ok) return toMfaFailure(r);
  const codes = Array.isArray(r.data?.recoveryCodes) ? r.data.recoveryCodes.filter((c): c is string => typeof c === 'string') : [];
  return codes.length ? { ok: true, recoveryCodes: codes } : { ok: false, reason: 'failed' };
}

export async function ackRecoveryCodes(): Promise<{ ok: true } | MfaFailure> {
  const r = await post('/v1/auth/mfa/recovery-codes/ack', {}, await readSession());
  return r.ok ? { ok: true } : toMfaFailure(r);
}

// ---- 4.6 관리자 ----

export type AdminResetReason = 'lost_phone' | 'new_phone' | 'app_deleted' | 'other';
export const ADMIN_RESET_REASONS: readonly AdminResetReason[] = ['lost_phone', 'new_phone', 'app_deleted', 'other'];

export async function adminResetMfa(
  userId: string,
  input: { code: string; reason: AdminResetReason; memo: string | null; identityChecked: true },
): Promise<{ ok: true; enrollTicket: string; ticketExpiresAt: string } | MfaFailure> {
  const r = await post<{ enrollTicket: string; ticketExpiresAt: string }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/mfa-reset`,
    { code: input.code, reason: input.reason, identityChecked: true, ...(input.memo ? { memo: input.memo } : {}) },
    await readSession(),
  );
  if (!r.ok) return toMfaFailure(r);
  if (typeof r.data?.enrollTicket !== 'string' || !/^[0-9]{8}$/.test(r.data.enrollTicket)) return { ok: false, reason: 'failed' };
  return { ok: true, enrollTicket: r.data.enrollTicket, ticketExpiresAt: typeof r.data.ticketExpiresAt === 'string' ? r.data.ticketExpiresAt : '' };
}

export type AdminMfaState = 'enrolled' | 'not_enrolled' | 'reset_pending';
const isState = (v: unknown): v is AdminMfaState => v === 'enrolled' || v === 'not_enrolled' || v === 'reset_pending';

export type AdminMfaInfo = { state: AdminMfaState; enrolledAt: string | null; lastUsedAt: string | null; ticketPendingUntil: string | null };

export async function adminGetMfa(userId: string): Promise<{ ok: true; info: AdminMfaInfo } | MfaFailure> {
  const r = await apiFetch<Record<string, unknown>>(`/v1/admin/users/${encodeURIComponent(userId)}/mfa`, { method: 'GET', session: await readSession() });
  if (!r.ok) return toMfaFailure(r);
  if (!isState(r.data?.state)) return { ok: false, reason: 'failed' };
  return { ok: true, info: { state: r.data.state, enrolledAt: str(r.data.enrolledAt), lastUsedAt: str(r.data.lastUsedAt), ticketPendingUntil: str(r.data.ticketPendingUntil) } };
}

// 운영자 목록 열용(활성 관리자 전원 한 번에). 실패·옛 API면 null — 열을 그리지 않는다.
export async function adminMfaOverview(): Promise<Map<string, AdminMfaState> | null> {
  const r = await apiFetch<{ items?: unknown }>('/v1/admin/mfa/overview', { method: 'GET', session: await readSession() });
  if (!r.ok || !Array.isArray(r.data?.items)) return null;
  const map = new Map<string, AdminMfaState>();
  for (const it of r.data.items as Array<Record<string, unknown>>) {
    if (typeof it?.userId === 'string' && isState(it.state)) map.set(it.userId, it.state);
  }
  return map;
}
