'use server';

import { redirect } from 'next/navigation';
import * as mfa from '@/lib/db/mfa';
import { isOtp, normalizeOtp } from '@/lib/mfa-format';
import { noticeOf, profileNameFor, qrView, todayLong } from '@/lib/mfa-setup';
import type { SetupNotice, SetupView } from '@/lib/mfa-setup-types';

// M4 /admin/security(내 보안 설정)의 단계 액션(기획서 3.5, 4.4 입구 A·C, 4.5, 디자인 스펙 T-7).
// 로그인 중 등록(app/actions/auth.ts otpSetupStep)과 같은 방식: intent 하나로 단계를 옮기고, 이전 상태에 기대지 않는다.
// 권한은 API가 세션으로 다시 본다(관리자만, 4.5). 세션이 없거나 끝났으면 상태 카드에 다시 로그인 안내를 띄운다.
//
// 입구 A(유예 기간 첫 등록): 앱 준비 → start({}) → QR → confirm(기존 세션 지우고 새 세션, lib가 쿠키를 다시 쓴다) → 복구 코드
// 입구 C(인증 앱 바꾸기): 재확인(6자리 또는 복구 코드) → start → 앱 준비 → QR(복구 코드 새로 받기 선택) → confirm → 복구 코드 또는 완료
// 복구 코드 새로 받기: 재확인(6자리) → recovery-codes → 복구 코드

type Entry = 'A' | 'C';

const entryOf = (fd: FormData): Entry => (fd.get('entry') === 'C' ? 'C' : 'A');
const checkedOf = (fd: FormData): 'otp' | 'rc' => (fd.get('checkedWith') === 'rc' ? 'rc' : 'otp');

// 상태 카드로 돌아가야 하는 실패(세션 없음·관리자 아님·이미 등록됨 등)
function statusNoticeOf(f: mfa.MfaFailure): SetupNotice | null {
  if (f.reason === 'unauthenticated') return { kind: 'session_expired' };
  if (f.reason === 'not_admin') return { kind: 'not_admin' };
  if (f.reason === 'already_enrolled') return { kind: 'already' };
  if (f.reason === 'not_enrolled' || f.reason === 'ticket_required' || f.reason === 'unsupported') return { kind: 'failed' };
  return null;
}

async function qrAgain(entry: Entry, rotateDefault: boolean, extra: { error?: 'format' | 'wrong' | 'used'; attemptsLeft?: number; notice?: SetupNotice } = {}): Promise<SetupView> {
  const cur = await mfa.getCurrentEnrollment();
  if (cur.ok) return { step: 'qr', entry, qr: qrView(cur.enrollment), rotateDefault, ...extra };
  if (cur.reason === 'no_enrollment') return { step: 'qr_expired', entry };
  const back = statusNoticeOf(cur);
  return back ? { step: 'status', notice: back } : { step: 'qr_expired', entry, notice: noticeOf(cur) };
}

async function startA(renew: boolean, onFail: SetupView): Promise<SetupView> {
  const r = await mfa.startMfaEnroll({ renew });
  if (r.ok) return { step: 'qr', entry: 'A', qr: qrView(r.enrollment), rotateDefault: false };
  const back = statusNoticeOf(r);
  if (back) return { step: 'status', notice: back };
  return { ...onFail, notice: noticeOf(r) } as SetupView;
}

function recheckFailure(f: mfa.MfaFailure, purpose: 'change' | 'regen', mode: 'otp' | 'rc'): SetupView {
  const base = { step: 'recheck' as const, purpose, mode };
  if (f.reason === 'wrong_code') return { ...base, error: 'wrong' };
  if (f.reason === 'code_reused') return { ...base, error: mode === 'otp' ? 'used' : 'wrong' };
  if (f.reason === 'validation') return { ...base, error: 'format' };
  const back = statusNoticeOf(f);
  if (back) return { step: 'status', notice: back };
  return { ...base, notice: noticeOf(f) };
}

async function recheck(fd: FormData): Promise<SetupView> {
  const purpose = fd.get('purpose') === 'regen' ? 'regen' : 'change';
  const mode = purpose === 'change' && fd.get('mode') === 'rc' ? 'rc' : 'otp';
  if (mode === 'rc') {
    const recoveryCode = ((fd.get('recoveryCode') as string | null) ?? '').trim();
    if (!recoveryCode || recoveryCode.length > 40) return { step: 'recheck', purpose, mode, error: 'format' };
    const r = await mfa.startMfaEnroll({ recoveryCode });
    if (!r.ok) return recheckFailure(r, purpose, mode);
    return { step: 'prep', entry: 'C', checkedWith: 'rc' };
  }
  const code = normalizeOtp((fd.get('code') as string | null) ?? '');
  if (!isOtp(code)) return { step: 'recheck', purpose, mode, error: 'format' };
  if (purpose === 'regen') {
    const r = await mfa.regenerateRecoveryCodes(code);
    if (!r.ok) return recheckFailure(r, purpose, mode);
    return { step: 'codes', codes: r.recoveryCodes, issuedOn: todayLong(), name: await profileNameFor(null, null), reason: 'regen' };
  }
  const r = await mfa.startMfaEnroll({ currentCode: code });
  if (!r.ok) return recheckFailure(r, purpose, mode);
  return { step: 'prep', entry: 'C', checkedWith: 'otp' };
}

async function confirm(fd: FormData): Promise<SetupView> {
  const entry = entryOf(fd);
  // 입구 C: 복구 코드로 확인했으면 새로 받기를 기본으로 켠다(3.4). 다시 그릴 때도 사용자가 고른 값을 따른다
  const rotate = fd.get('rotate') === 'on';
  const enrollmentId = ((fd.get('enrollmentId') as string | null) ?? '').trim();
  const code = normalizeOtp((fd.get('code') as string | null) ?? '');
  if (!enrollmentId || !isOtp(code)) return qrAgain(entry, rotate, { error: 'format' });
  // A는 서버가 늘 새로 발급한다(값은 의미 없음). C는 API 기본값이 false라 늘 명시한다(4.11 D-6).
  const r = await mfa.confirmMfaEnroll({ enrollmentId, code, rotateRecoveryCodes: entry === 'A' ? true : rotate });
  if (r.ok) {
    if (!r.recoveryCodes?.length) return { step: 'changed' };
    return {
      step: 'codes',
      codes: r.recoveryCodes,
      issuedOn: todayLong(),
      name: await profileNameFor(r.sessionToken, r.userId),
      reason: entry === 'A' ? 'enroll' : 'change',
    };
  }
  if (r.reason === 'wrong_code') return qrAgain(entry, rotate, { error: 'wrong', ...(r.attemptsLeft !== undefined ? { attemptsLeft: r.attemptsLeft } : {}) });
  if (r.reason === 'code_reused') return qrAgain(entry, rotate, { error: 'used' });
  if (r.reason === 'validation') return qrAgain(entry, rotate, { error: 'format' });
  if (r.reason === 'enrollment_expired' || r.reason === 'not_found' || r.reason === 'no_enrollment') return { step: 'qr_expired', entry };
  const back = statusNoticeOf(r);
  if (back) return { step: 'status', notice: back };
  return qrAgain(entry, rotate, { notice: noticeOf(r) });
}

export async function securityStep(_prev: SetupView, formData: FormData): Promise<SetupView> {
  const intent = formData.get('intent');
  switch (intent) {
    case 'enroll':
      return { step: 'prep', entry: 'A' };
    case 'change':
      return { step: 'recheck', purpose: 'change', mode: formData.get('mode') === 'rc' ? 'rc' : 'otp' };
    case 'regen':
      return { step: 'recheck', purpose: 'regen', mode: 'otp' };
    case 'recheck':
      return recheck(formData);
    case 'next': {
      const entry = entryOf(formData);
      if (entry === 'A') return startA(false, { step: 'prep', entry: 'A' });
      // 입구 C는 재확인 때 이미 등록 대기를 만들었다. 새로고침·이전으로 돌아와도 같은 것을 다시 그린다(4.4.3)
      const cur = await mfa.getCurrentEnrollment();
      if (cur.ok) return { step: 'qr', entry: 'C', qr: qrView(cur.enrollment), rotateDefault: checkedOf(formData) === 'rc' };
      if (cur.reason === 'no_enrollment') return { step: 'recheck', purpose: 'change', mode: checkedOf(formData) };
      const back = statusNoticeOf(cur);
      return back ? { step: 'status', notice: back } : { step: 'prep', entry: 'C', checkedWith: checkedOf(formData), notice: noticeOf(cur) };
    }
    case 'renew':
      // 입구 C의 [QR 새로 만들기]는 재확인을 다시 묻는다(4.11 D-5)
      if (entryOf(formData) === 'C') return { step: 'recheck', purpose: 'change', mode: 'otp' };
      return startA(true, { step: 'qr_expired', entry: 'A' });
    case 'confirm':
      return confirm(formData);
    case 'back': {
      const to = formData.get('to');
      if (to === 'prep') return { step: 'prep', entry: entryOf(formData), checkedWith: checkedOf(formData) };
      return { step: 'status' };
    }
    case 'ack':
      // 체크 뒤 이동. 보관 확인 기록이 실패해도 이동은 막지 않는다(M6 배너가 다시 알린다, T-5.4).
      await mfa.ackRecoveryCodes();
      redirect('/admin');
    case 'done':
      redirect('/admin');
    default:
      return { step: 'status' };
  }
}
