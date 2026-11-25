import 'server-only';
import { apiFetch, type ApiResult } from './api';
import { formField, type FormField } from '@/lib/form-messages';
import { clearSession, readSession, writeSession } from './session-cookie';

type Issued = { sessionToken: string; expiresAt: string };

export type SessionInfo = {
  user: { id: string; email: string; emailConfirmedAt: string | null };
  profile: { role: string; status: string } | null;
  // 슬라이딩 만료가 반영된 세션 만료 시각(ISO). 옛 API 응답에는 없을 수 있다.
  expiresAt?: string;
  // 이 요청에서 세션 만료가 실제로 늘어났는지. true일 때만 proxy가 쿠키를 다시 쓴다(옛 API 응답에는 없음 → 쓰지 않음).
  renewed?: boolean;
};

export type SignUpInput = { email: string; password: string; name: string; phone: string | null };
// 실패 사유: 429는 IP 한도(요청이 많음), 400은 API 입력 검증, 503은 연결 불가 — 화면이 문구를 나눌 수 있게 구분한다.
export type FailReason = 'rate_limited' | 'validation' | 'unavailable' | 'failed';
// field: API가 400으로 문제 삼은 입력 칸(있을 때만)
export type SignUpResult = { ok: true; status: 'pending_confirmation' } | { ok: false; reason: FailReason; field?: FormField };
export type ResendResult = { ok: true } | { ok: false; reason: FailReason; field?: FormField };
export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_credentials' | 'email_not_confirmed' | 'rate_limited' | 'unavailable' | 'validation' | 'failed'; field?: FormField };
export type ResetResult = { ok: true } | { ok: false; field?: FormField };

function fieldOf(r: { status: number; error: { field?: string } }): { field?: FormField } {
  const field = r.status === 400 ? formField(r.error.field) : undefined;
  return field ? { field } : {};
}

function failReason(r: { status: number }): FailReason {
  if (r.status === 429) return 'rate_limited';
  if (r.status === 400) return 'validation';
  if (r.status === 503) return 'unavailable';
  return 'failed';
}
export type ChangePasswordResult = { ok: true } | { ok: false; reason: 'wrong_current' | 'unauthenticated' | 'validation' | 'failed'; field?: string };

// a 401 can also be `unauthorized_service` (bad service key) — that is not the user's session
export function isDeadSession(r: ApiResult<unknown>): boolean {
  return !r.ok && r.status === 401 && r.error.code === 'unauthenticated';
}

export async function signUp(input: SignUpInput, origin: string): Promise<SignUpResult> {
  const r = await apiFetch<{ status: 'pending_confirmation' }>('/v1/auth/signup', {
    method: 'POST',
    body: { ...input, origin },
  });
  return r.ok ? { ok: true, status: r.data.status } : { ok: false, reason: failReason(r), ...fieldOf(r) };
}

export async function resend(email: string, origin: string): Promise<ResendResult> {
  const r = await apiFetch('/v1/auth/resend', { method: 'POST', body: { email, origin } });
  return r.ok ? { ok: true } : { ok: false, reason: failReason(r), ...fieldOf(r) };
}

// 가입 링크(/auth/confirm?token=)의 상태. API `GET /v1/auth/signup-link/check` — 읽기 전용이라 토큰·실패 횟수·세션·쿠키를 바꾸지 않는다.
// 계약: docs/02-design/features/bara-edu-lms.signup-verify-password.api.md
export type SignupLinkCheck =
  | { state: 'ready'; email: string; requestedAt: string; expiresAt: string; attemptsLeft: number }
  | { state: 'done' | 'expired' | 'locked' | 'invalid' };
export type CheckSignupLinkResult = { ok: true; link: SignupLinkCheck } | { ok: false; reason: 'rate_limited' | 'unavailable' | 'failed' };

// 토큰은 쿼리스트링이 아닌 헤더로 보낸다(API 접근 로그에 토큰이 남지 않게)
export async function checkSignupLink(token: string): Promise<CheckSignupLinkResult> {
  const r = await apiFetch<SignupLinkCheck>('/v1/auth/signup-link/check', { method: 'GET', headers: { 'x-bara-signup-token': token } });
  if (r.ok) return { ok: true, link: r.data };
  return { ok: false, reason: r.status === 429 ? 'rate_limited' : r.status === 503 ? 'unavailable' : 'failed' };
}

export type CompleteSignupResult =
  | { ok: true }
  | { ok: false; reason: 'wrong_password'; attemptsLeft: number }
  | { ok: false; reason: 'link_locked' | 'link_expired' | 'link_done' | 'invalid_token' | 'rate_limited' | 'unavailable' | 'failed' }
  | { ok: false; reason: 'validation'; field?: FormField };

// 가입 확정: 링크 토큰 + 가입 때 입력한 비밀번호. 성공하면 세션 쿠키를 쓴다(자동 로그인).
// 비밀번호는 로그·URL에 남기지 않는다(호출한 Server Action이 메모리로만 다룬다).
export async function completeSignup(token: string, password: string): Promise<CompleteSignupResult> {
  const r = await apiFetch<Issued>('/v1/auth/signup-link/complete', { method: 'POST', body: { token, password } });
  if (r.ok) {
    await writeSession(r.data.sessionToken, r.data.expiresAt);
    return { ok: true };
  }
  if (r.status === 403 && r.error.message === 'wrong_password') return { ok: false, reason: 'wrong_password', attemptsLeft: r.error.attemptsLeft ?? 0 };
  if (r.status === 409) {
    const m = r.error.message;
    if (m === 'link_locked' || m === 'link_expired' || m === 'link_done') return { ok: false, reason: m };
  }
  if (r.status === 400) {
    return r.error.message === 'invalid_token' ? { ok: false, reason: 'invalid_token' } : { ok: false, reason: 'validation', ...fieldOf(r) };
  }
  return { ok: false, reason: r.status === 429 ? 'rate_limited' : r.status === 503 ? 'unavailable' : 'failed' };
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const r = await apiFetch<Issued & { userId: string }>('/v1/auth/login', { method: 'POST', body: { email, password } });
  if (r.ok) {
    await writeSession(r.data.sessionToken, r.data.expiresAt);
    return { ok: true };
  }
  if (r.status === 401 && r.error.code === 'unauthenticated') {
    return { ok: false, reason: r.error.message === 'email_not_confirmed' ? 'email_not_confirmed' : 'invalid_credentials' };
  }
  if (r.status === 400) return { ok: false, reason: 'validation', ...fieldOf(r) };
  return { ok: false, reason: r.status === 429 ? 'rate_limited' : r.status === 503 ? 'unavailable' : 'failed' };
}

export async function logout(): Promise<void> {
  const session = await readSession();
  if (session) await apiFetch('/v1/auth/logout', { method: 'POST', session });
  await clearSession();
}

// the API revokes the user's other sessions; the current cookie stays valid
export async function changePassword(currentPassword: string, newPassword: string): Promise<ChangePasswordResult> {
  const session = await readSession();
  if (!session) return { ok: false, reason: 'unauthenticated' };
  const r = await apiFetch('/v1/auth/change-password', { method: 'POST', session, body: { currentPassword, newPassword } });
  if (r.ok) return { ok: true };
  if (r.status === 403) return { ok: false, reason: 'wrong_current' };
  if (r.status === 400) return { ok: false, reason: 'validation', ...(r.error.field ? { field: r.error.field } : {}) };
  return { ok: false, reason: isDeadSession(r) ? 'unauthenticated' : 'failed' };
}

export async function requestReset(email: string, origin: string): Promise<boolean> {
  return (await apiFetch('/v1/auth/request-reset', { method: 'POST', body: { email, origin } })).ok;
}

export async function resetPassword(token: string, newPassword: string): Promise<ResetResult> {
  const r = await apiFetch('/v1/auth/reset-password', { method: 'POST', body: { token, newPassword } });
  if (r.ok) {
    await clearSession();
    return { ok: true };
  }
  return { ok: false, ...fieldOf(r) };
}

// token and IP are explicit so proxy.ts can call this without next/headers
export async function getSession(token: string, clientIp: string | null): Promise<ApiResult<SessionInfo>> {
  return apiFetch<SessionInfo>('/v1/auth/session', { method: 'GET', session: token, clientIp });
}

export type WithdrawResult = { ok: true } | { ok: false; reason: 'active_enrollment' | 'unauthenticated' | 'failed' };

// 탈퇴 전체(검증·익명화·학습 이력 파기·전체 세션 삭제·사진 삭제)를 API가 한 트랜잭션으로 처리한다.
// 성공하면 서버의 세션이 이미 없어졌으므로 호출한 쪽은 쿠키만 지우면 된다.
export async function withdrawAccount(reason: string, detail: string | null): Promise<WithdrawResult> {
  const r = await apiFetch('/v1/account/withdraw', { method: 'POST', session: await readSession(), body: { reason, detail } });
  if (r.ok) return { ok: true };
  if (r.status === 409 && r.error.message === 'active_enrollment') return { ok: false, reason: 'active_enrollment' };
  return { ok: false, reason: isDeadSession(r) ? 'unauthenticated' : 'failed' };
}

// 409 password_not_set: 가입을 마무리하지 않아 비밀번호가 없는 계정은 관리자도 대신 인증할 수 없다(대표 결정 5).
export type AdminConfirmResult = { ok: true } | { ok: false; reason: 'password_not_set' | 'failed' };

export async function adminConfirmEmail(userId: string): Promise<AdminConfirmResult> {
  const r = await apiFetch(`/v1/admin/users/${encodeURIComponent(userId)}/confirm-email`, { method: 'POST', session: await readSession() });
  if (r.ok) return { ok: true };
  if (r.status === 409 && r.error.message === 'password_not_set') return { ok: false, reason: 'password_not_set' };
  return { ok: false, reason: 'failed' };
}

export async function adminSendReset(userId: string, origin: string): Promise<boolean> {
  const r = await apiFetch<{ mailSent: boolean }>(`/v1/admin/users/${encodeURIComponent(userId)}/send-reset`, {
    method: 'POST',
    session: await readSession(),
    body: { origin },
  });
  return r.ok && r.data.mailSent === true;
}

export async function listEmailConfirmations(): Promise<Array<{ id: string; emailConfirmedAt: string | null }> | null> {
  const r = await apiFetch<{ items: Array<{ id: string; emailConfirmedAt: string | null }> }>('/v1/admin/users/confirmations', {
    method: 'GET',
    session: await readSession(),
  });
  return r.ok ? r.data.items : null;
}
