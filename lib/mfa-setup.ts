import 'server-only';
import { apiFetch } from '@/lib/db/api';
import { getCurrentEnrollment, type Enrollment, type MfaFailure } from '@/lib/db/mfa';
import { TableBuilder, type Send } from '@/lib/db/query-builder';
import { readSession } from '@/lib/db/session-cookie';
import { keyGroups, kstLongDate } from '@/lib/mfa-format';
import { qrSvg } from '@/lib/qr';
import type { LockInfo, QrView, SetupNotice, SetupView } from '@/lib/mfa-setup-types';

// 등록 단계(M3, 입구 A·B·C)의 서버 쪽 도우미. 화면 상태 타입은 lib/mfa-setup-types.ts(클라이언트도 읽는다).
// QR·설정 키·otpauthUri는 이 파일에서 화면 상태로만 만든다 — 로그·오류 추적에 넘기지 않는다(4.4.4 끝, 보안 점검 M-11).

export function qrView(e: Enrollment): QrView {
  const qr = qrSvg(e.otpauthUri);
  return { enrollmentId: e.enrollmentId, size: qr.size, path: qr.path, keyGroups: keyGroups(e.secretBase32), otpauthUri: e.otpauthUri };
}

export function lockOf(f: MfaFailure): LockInfo {
  return { lockScope: f.lockScope ?? 'account', minutes: f.retryAfterMinutes ?? 15 };
}

// 폼 위 알림으로 보여 줄 실패(입력값 유지). 화면 전환이 필요한 실패는 호출한 쪽이 먼저 처리한다.
export function noticeOf(f: MfaFailure): SetupNotice {
  if (f.reason === 'rate_limited') return { kind: 'rate_limited' };
  if (f.reason === 'unavailable' || f.reason === 'log_failed') return { kind: 'unavailable' };
  if (f.reason === 'mfa_locked') return { kind: 'locked', ...lockOf(f) };
  return { kind: 'failed' };
}

// 인쇄용 안내지의 "관리자 이름"(1.3 D6: 이름은 넣고 이메일은 넣지 않는다). 못 읽으면 null — 인쇄에서 그 줄만 뺀다.
// 방금 받은 세션(입구 A·B 확정 응답)은 아직 요청 쿠키에 없으므로 토큰을 직접 넘긴다.
export async function profileNameFor(token: string | null, userId: string | null): Promise<string | null> {
  const session = token ?? (await readSession());
  if (!session) return null;
  try {
    let id = userId;
    if (!id) {
      const me = await apiFetch<{ user?: { id?: unknown } }>('/v1/auth/session', { method: 'GET', session });
      id = me.ok && typeof me.data?.user?.id === 'string' ? me.data.user.id : null;
    }
    if (!id) return null;
    const send: Send = (path, body) => apiFetch(path, { method: 'POST', body, session });
    const { data } = await new TableBuilder(send, 'profiles').select('name').eq('id', id).maybeSingle();
    const name = (data as { name?: unknown } | null)?.name;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

export const todayLong = (now: number = Date.now()) => kstLongDate(new Date(now).toISOString());

// 입구 B(로그인 중)에서 폼 대신 상태 화면으로 끝나는 실패. 그 밖의 실패는 null(호출한 쪽이 알림으로 그린다).
export function enrollEndOf(f: MfaFailure): SetupView | null {
  if (f.reason === 'challenge_invalid' || f.reason === 'challenge_exhausted' || f.reason === 'unauthenticated' || f.reason === 'already_enrolled') {
    return { step: 'end', screen: 'expired' };
  }
  if (f.reason === 'account_changed' || f.reason === 'not_admin') return { step: 'end', screen: 'demoted' };
  if (f.reason === 'ticket_unusable') return { step: 'end', screen: 'ticket_dead' };
  return null;
}

// 입구 B 화면을 처음(또는 새로고침으로) 그릴 때: 서버가 기억하는 단계로 돌아간다(T-0 #8, 4.4.3).
// 등록 대기가 있으면 같은 QR, 없으면 등록 코드 확인 여부에 따라 [QR 새로 만들기] 또는 앱 준비 단계.
export async function initialEnrollView(challenge: string): Promise<SetupView> {
  const cur = await getCurrentEnrollment(challenge);
  if (cur.ok) return { step: 'qr', entry: 'B', qr: qrView(cur.enrollment), rotateDefault: false };
  if (cur.reason === 'no_enrollment' && cur.ticketVerified) return { step: 'qr_expired', entry: 'B' };
  return enrollEndOf(cur) ?? { step: 'prep', entry: 'B' };
}
