import 'server-only';
import { apiFetch, type ApiResult } from './api';
import { clearSession, readSession, writeSession } from './session-cookie';

type Issued = { sessionToken: string; expiresAt: string };

export type SessionInfo = {
  user: { id: string; email: string; emailConfirmedAt: string | null };
  profile: { role: string; status: string } | null;
  // 슬라이딩 만료가 반영된 세션 만료 시각(ISO). 옛 API 응답에는 없을 수 있다.
  expiresAt?: string;
};

export type SignUpInput = { email: string; password: string; name: string; phone: string | null };
// 실패 사유: 429는 IP 한도(요청이 많음), 400은 API 입력 검증, 503은 연결 불가 — 화면이 문구를 나눌 수 있게 구분한다.
export type FailReason = 'rate_limited' | 'validation' | 'unavailable' | 'failed';
export type SignUpResult = { ok: true; status: 'pending_confirmation' } | { ok: false; reason: FailReason };
export type ResendResult = { ok: true } | { ok: false; reason: FailReason };
export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_credentials' | 'email_not_confirmed' | 'rate_limited' | 'unavailable' | 'failed' };

function failReason(r: { status: number }): FailReason {
  if (r.status === 429) return 'rate_limited';
  if (r.status === 400) return 'validation';
  if (r.status === 503) return 'unavailable';
  return 'failed';
}
export type ChangePasswordResult = { ok: true } | { ok: false; reason: 'wrong_current' | 'unauthenticated' | 'failed' };

// a 401 can also be `unauthorized_service` (bad service key) — that is not the user's session
export function isDeadSession(r: ApiResult<unknown>): boolean {
  return !r.ok && r.status === 401 && r.error.code === 'unauthenticated';
}

export async function signUp(input: SignUpInput, origin: string): Promise<SignUpResult> {
  const r = await apiFetch<{ status: 'pending_confirmation' }>('/v1/auth/signup', {
    method: 'POST',
    body: { ...input, origin },
  });
  return r.ok ? { ok: true, status: r.data.status } : { ok: false, reason: failReason(r) };
}

export async function resend(email: string, origin: string): Promise<ResendResult> {
  const r = await apiFetch('/v1/auth/resend', { method: 'POST', body: { email, origin } });
  return r.ok ? { ok: true } : { ok: false, reason: failReason(r) };
}

export async function verifyEmail(token: string): Promise<boolean> {
  const r = await apiFetch<Issued>('/v1/auth/verify-email', { method: 'POST', body: { token } });
  if (!r.ok) return false;
  await writeSession(r.data.sessionToken, r.data.expiresAt);
  return true;
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
  return { ok: false, reason: isDeadSession(r) ? 'unauthenticated' : 'failed' };
}

export async function requestReset(email: string, origin: string): Promise<boolean> {
  return (await apiFetch('/v1/auth/request-reset', { method: 'POST', body: { email, origin } })).ok;
}

export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  const r = await apiFetch('/v1/auth/reset-password', { method: 'POST', body: { token, newPassword } });
  if (r.ok) await clearSession();
  return r.ok;
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

export async function adminConfirmEmail(userId: string): Promise<boolean> {
  const r = await apiFetch(`/v1/admin/users/${encodeURIComponent(userId)}/confirm-email`, { method: 'POST', session: await readSession() });
  return r.ok;
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
