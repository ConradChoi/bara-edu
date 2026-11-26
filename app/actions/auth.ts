'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import * as auth from '@/lib/db/auth';
import * as mfa from '@/lib/db/mfa';
import { clearMfaChallenge, readMfaChallenge } from '@/lib/db/session-cookie';
import { isOtp, isTicket, normalizeOtp, normalizeTicket } from '@/lib/mfa-format';
import { enrollEndOf, lockOf, noticeOf, profileNameFor, qrView, todayLong } from '@/lib/mfa-setup';
import type { MfaLoginState, SetupView } from '@/lib/mfa-setup-types';
import { RECENT_SUBMIT_COOKIE } from '@/data/diagnosis/config';
import { siteConfig } from '@/data/site-config';
import { getSiteOrigin } from '@/lib/site-origin';
import { FIELD_MESSAGES, LIMITS, MSG_PASSWORD_MISMATCH, MSG_RATE_LIMITED, MSG_UNAVAILABLE, isApiEmail } from '@/lib/form-messages';

// source: 'login'은 인증 전 계정으로 로그인한 경우다 — 메일을 새로 보내지 않았으므로 "메일을 보냈어요" 문구를 쓰면 안 된다.
export type AuthFormState = { error: string } | { pendingConfirmation: true; email: string; source?: 'login' } | undefined;

// 가입 마무리(/auth/confirm) 화면의 서버 액션 결과. 성공하면 redirect()라 값이 없다.
// status: 화면이 상태 화면(잠김·만료·이미 가입·무효)으로 바뀐다. wrong_password: 같은 화면에 오류+남은 횟수.
// error: 같은 화면 위에 알림만(남은 횟수는 줄지 않는다).
export type SignupFinishStatus = 'locked' | 'expired' | 'done' | 'invalid';
export type SignupFinishState =
  | { kind: 'wrong_password'; attemptsLeft: number }
  | { kind: 'status'; status: SignupFinishStatus }
  | { kind: 'error'; error: 'empty' | 'unavailable' | 'rate_limited' | 'failed' }
  | undefined;

// 비밀번호 찾기(/forgot-password)의 서버 액션 결과. 문구는 화면이 정한다(카피 문서 FP-*).
// requested: 200 — 계정이 있든 없든, 이메일 한도에 걸렸든 같은 값이다(이메일 열거 방지). 서버 응답 값은 싣지 않는다.
// error: 입력 칸 아래(empty·format) 또는 칸 위 알림(rate_limited·unavailable·failed). email은 입력 유지용(JS 없이도 칸을 다시 채운다).
// resend: 보냄 화면의 [메일 다시 받기]에서 온 요청인지 — 결과를 보냄 화면에 그대로 그린다.
export type ForgotPasswordError = 'empty' | 'format' | 'rate_limited' | 'unavailable' | 'failed';
export type ForgotPasswordState =
  | { requested: true; email: string; resend: boolean }
  | { error: ForgotPasswordError; email: string; resend: boolean }
  | undefined;

export type ResetPasswordError = 'short' | 'long' | 'mismatch' | 'rule' | 'expired' | 'unavailable';
export type ResetPasswordState = { error: ResetPasswordError } | undefined;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ?redirect= 값을 검증 없이 그대로 redirect()에 넘기면 오픈 리다이렉트(CWE-601)로
// 피싱에 악용될 수 있다(security-officer 점검, 2026-08-06). 사이트 내부 상대경로만 허용한다.
//
// 브라우저(WHATWG URL 파서)는 URL 안의 탭·개행을 지우고 `\`를 `/`로 취급한다 — "/\t/evil.com"은
// "//evil.com"(프로토콜 상대 URL)이 되고 "/\evil.com"도 마찬가지다. 그래서 제어문자(C0·DEL·C1)와
// 공백(유니코드 공백 포함), 역슬래시가 하나라도 있으면 통째로 거부한다. 마지막으로 실제 URL 파서로
// 같은 출처인지 한 번 더 확인한다.
const UNSAFE_REDIRECT_CHARS = /[\u0000-\u001f\u007f-\u009f\s\\]/;
const FALLBACK_REDIRECT = '/my';
const MAX_REDIRECT_LENGTH = 2048;

// fallback: 관리자 2단계를 마친 뒤에는 '/admin'(기획서 2.2 "2단계 성공").
function safeRedirect(path: string | null, fallback: string = FALLBACK_REDIRECT): string {
  if (!path || path.length > MAX_REDIRECT_LENGTH) return fallback;
  if (UNSAFE_REDIRECT_CHARS.test(path)) return fallback;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) return fallback;
  try {
    const base = 'http://redirect-check.invalid';
    if (new URL(path, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return path;
}

export async function signup(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const name = (formData.get('name') as string | null)?.trim() ?? '';
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  const passwordConfirm = (formData.get('passwordConfirm') as string | null) ?? '';
  const phone = (formData.get('phone') as string | null)?.trim() || null;

  // API가 400으로 거절하는 한도(이름 100자, 이메일 규칙, 비밀번호 200자, 연락처 30자)는 먼저 검사해 칸별로 안내한다.
  if (name.length < 2) return { error: '이름을 2자 이상 입력해 주세요' };
  if (name.length > LIMITS.name) return { error: `이름은 ${LIMITS.name}자 이하로 입력해 주세요` };
  if (!EMAIL_RE.test(email) || !isApiEmail(email)) return { error: '올바른 이메일 형식이 아니에요' };
  if (password.length < 8) return { error: '비밀번호는 8자 이상이어야 해요' };
  if (password.length > LIMITS.password) return { error: `비밀번호는 ${LIMITS.password}자 이하로 입력해 주세요` };
  // 화면에서 먼저 막지만 JS가 없거나 우회한 요청의 안전장치. 두 칸 모두 앞뒤 공백까지 그대로 비교한다.
  if (!passwordConfirm) return { error: '비밀번호를 한 번 더 입력해 주세요' };
  if (password !== passwordConfirm) return { error: MSG_PASSWORD_MISMATCH };
  if (phone && phone.length > LIMITS.phone) return { error: `연락처는 ${LIMITS.phone}자 이하로 입력해 주세요` };
  if (formData.get('agreeTerms') !== 'on' || formData.get('agreePrivacy') !== 'on') {
    return { error: '이용약관과 개인정보 수집·이용에 모두 동의해야 가입할 수 있어요' };
  }

  const r = await auth.signUp({ email, password, name, phone }, await getSiteOrigin());
  if (!r.ok) {
    if (r.reason === 'rate_limited') return { error: MSG_RATE_LIMITED };
    if (r.reason === 'unavailable') return { error: MSG_UNAVAILABLE };
    // 위 칸별 검사를 통과하고도 400이면 API가 알려 준 칸(error.field)의 문구를 쓰고, 칸을 모르면 이메일을 살펴보라고 안내한다.
    if (r.reason === 'validation' && r.field) return { error: FIELD_MESSAGES[r.field] };
    if (r.reason === 'validation') return { error: '입력한 내용을 다시 확인해 주세요. 이메일 주소를 특히 살펴봐 주세요' };
    return { error: '가입 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요' };
  }
  // 신규·이미 가입·미인증 모두 같은 응답이다(이메일 열거 방지, 대표 결정 2026-11-25). 메일 종류는 API가 나눠 보낸다.
  // 가입 직후에는 세션이 없다 — 메일의 /auth/confirm 링크를 열고 가입할 때 정한 비밀번호를 입력해야 세션이 생긴다.
  return { pendingConfirmation: true, email };
}

// 인증 메일 링크가 만료됐거나 이미 사용된 경우를 위한 재전송. 존재하지
// 않는/이미 인증된 이메일이어도 API는 같은 응답을 주고, 실패도 원인을 그대로 노출하지 않고 같은
// 문구로 응답한다 — 가입 화면과 같이 계정 존재 여부를 구분해 알려주지 않는다(이메일 열거 방지, security-officer 관점).
export async function resendConfirmation(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  if (!EMAIL_RE.test(email) || !isApiEmail(email)) return { error: '올바른 이메일 형식이 아니에요' };

  const sent = await auth.resend(email, await getSiteOrigin());
  if (!sent.ok) {
    if (sent.reason === 'rate_limited') return { error: MSG_RATE_LIMITED };
    if (sent.reason === 'validation' && sent.field === 'email') return { error: FIELD_MESSAGES.email };
    return { error: `메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요. 계속 안 되면 전화로 문의해 주세요. ${siteConfig.phone}` };
  }

  return { pendingConfirmation: true, email };
}

// 비밀번호 찾기: 재설정 메일 요청. resendConfirmation과 같은 구조(형식 검사 → 호출 → 상태 매핑).
// 이메일은 로그에 남기지 않고 URL에도 싣지 않는다. 입력한 사람에게만 상태로 되돌려 보여 준다.
export async function requestPasswordReset(_prev: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const raw = formData.get('email');
  const email = typeof raw === 'string' ? raw.trim() : '';
  const resend = formData.get('resend') === '1';
  if (!email) return { error: 'empty', email, resend };
  if (!EMAIL_RE.test(email) || !isApiEmail(email)) return { error: 'format', email, resend };

  const r = await auth.requestReset(email, await getSiteOrigin());
  if (r.ok) return { requested: true, email, resend };
  if (r.reason === 'rate_limited') return { error: 'rate_limited', email, resend };
  if (r.reason === 'unavailable') return { error: 'unavailable', email, resend };
  if (r.reason === 'validation' && r.field === 'email') return { error: 'format', email, resend };
  // 400 field=origin, 401 서비스 키, 그 밖의 5xx — 사용자가 고칠 수 없는 문제
  return { error: 'failed', email, resend };
}

// 가입 마무리: 링크 토큰(hidden)과 가입 때 정한 비밀번호. 확정은 이 액션(POST)에서만 일어난다 — 링크를 여는 GET은 읽기 전용이다.
// 비밀번호·토큰은 로그에 남기지 않고 상태에도 담지 않는다(오류 상태에는 횟수·종류만).
export async function finishSignup(_prev: SignupFinishState, formData: FormData): Promise<SignupFinishState> {
  const token = (formData.get('token') as string | null) ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  if (!token) return { kind: 'status', status: 'invalid' };
  if (!password) return { kind: 'error', error: 'empty' };

  const r = await auth.completeSignup(token, password);
  if (r.ok) redirect('/my?welcome=1');
  switch (r.reason) {
    case 'wrong_password':
      return { kind: 'wrong_password', attemptsLeft: r.attemptsLeft };
    case 'link_locked':
      return { kind: 'status', status: 'locked' };
    case 'link_expired':
      return { kind: 'status', status: 'expired' };
    case 'link_done':
      return { kind: 'status', status: 'done' };
    case 'invalid_token':
      return { kind: 'status', status: 'invalid' };
    case 'rate_limited':
      return { kind: 'error', error: 'rate_limited' };
    case 'unavailable':
      return { kind: 'error', error: 'unavailable' };
    default:
      return { kind: 'error', error: 'failed' };
  }
}

export async function login(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  const redirectTo = safeRedirect(formData.get('redirect') as string | null);

  if (!email || !password) return { error: '이메일과 비밀번호를 입력해 주세요' };
  // API가 400으로 거절할 값은 보내지 않는다 — 어차피 맞는 계정일 수 없다.
  if (!isApiEmail(email)) return { error: '올바른 이메일 형식이 아니에요' };
  if (password.length > LIMITS.password) return { error: '이메일 또는 비밀번호가 올바르지 않아요' };

  const r = await auth.login(email, password);
  if (!r.ok) {
    if (r.reason === 'email_not_confirmed') return { pendingConfirmation: true, email, source: 'login' };
    if (r.reason === 'invalid_credentials') return { error: '이메일 또는 비밀번호가 올바르지 않아요' };
    if (r.reason === 'rate_limited') return { error: MSG_RATE_LIMITED };
    if (r.reason === 'unavailable') return { error: MSG_UNAVAILABLE };
    if (r.reason === 'validation' && r.field === 'email') return { error: FIELD_MESSAGES.email };
    if (r.reason === 'validation' && r.field === 'password') return { error: '이메일 또는 비밀번호가 올바르지 않아요' };
    return { error: '잠시 후 다시 시도해 주세요' };
  }

  // 관리자: 세션 대신 대기표(bara_mfa 쿠키는 lib가 이미 썼다). redirect 값은 안전한 경로일 때만 다음 화면으로 넘긴다(2.2).
  // 응답에 mfa가 없으면(지금의 운영 API 포함) 아래 기존 흐름 그대로다(배포 순서 호환, 7.1).
  if ('mfa' in r) {
    const raw = formData.get('redirect') as string | null;
    const q = new URLSearchParams();
    if (raw && safeRedirect(raw, '') === raw) q.set('redirect', raw);
    if (r.mfa === 'enroll_required' && r.enrollReason === 'reset') q.set('reason', 'reset');
    const qs = q.toString();
    redirect(`/sign-in/${r.mfa === 'required' ? 'otp' : 'otp-setup'}${qs ? `?${qs}` : ''}`);
  }

  redirect(redirectTo);
}

// ---- 관리자 로그인 2단계(M1·M2, 기획서 3.2·3.3, 디자인 스펙 T-3·T-4) ----
// 6자리·복구 코드·대기표는 상태에 담지 않는다. 대기표는 httpOnly 쿠키에서만 읽는다(2.2).

function mfaLoginFailure(f: mfa.MfaFailure, field: 'otp' | 'recovery'): MfaLoginState {
  switch (f.reason) {
    case 'wrong_code':
      return { kind: 'field', error: 'wrong', ...(f.attemptsLeft !== undefined ? { attemptsLeft: f.attemptsLeft } : {}) };
    case 'code_reused':
      // 재사용은 횟수를 세지 않는다(1.3 D1). 복구 코드는 재사용 구분이 없다(이미 쓴 코드 = 틀림)
      return field === 'otp' ? { kind: 'field', error: 'used' } : { kind: 'field', error: 'wrong' };
    case 'validation':
      return { kind: 'field', error: 'format' };
    case 'challenge_invalid':
    case 'unauthenticated':
      return { kind: 'screen', screen: 'expired' };
    case 'challenge_exhausted':
      return { kind: 'screen', screen: 'exhausted' };
    case 'account_changed':
    case 'not_admin':
      return { kind: 'screen', screen: 'demoted' };
    case 'mfa_locked':
      return { kind: 'screen', screen: 'locked', ...lockOf(f) };
    case 'rate_limited':
      return { kind: 'notice', notice: 'rate_limited' };
    case 'unavailable':
    case 'log_failed':
      return { kind: 'notice', notice: 'unavailable' };
    default:
      return { kind: 'notice', notice: 'failed' };
  }
}

async function finishMfaLogin(f: mfa.MfaFailure, field: 'otp' | 'recovery'): Promise<MfaLoginState> {
  const state = mfaLoginFailure(f, field);
  // 상태 화면(만료·5회·계정 변경·잠김)에서는 이 대기표를 다시 쓸 일이 없다 — 쿠키를 지운다.
  if (state?.kind === 'screen') await clearMfaChallenge();
  return state;
}

export async function verifyOtp(_prev: MfaLoginState, formData: FormData): Promise<MfaLoginState> {
  const code = normalizeOtp((formData.get('code') as string | null) ?? '');
  if (!isOtp(code)) return { kind: 'field', error: 'format' };
  const challenge = await readMfaChallenge();
  if (!challenge) return { kind: 'screen', screen: 'expired' };
  const r = await mfa.verifyMfa(challenge, code);
  if (!r.ok) return finishMfaLogin(r, 'otp');
  redirect(safeRedirect(formData.get('redirect') as string | null, '/admin'));
}

export async function verifyRecoveryCode(_prev: MfaLoginState, formData: FormData): Promise<MfaLoginState> {
  // 대소문자·하이픈·공백은 서버가 정규화한다(4.3). 앞뒤 공백만 지우고 길이만 본다.
  const code = ((formData.get('recoveryCode') as string | null) ?? '').trim();
  if (!code || code.length > 40) return { kind: 'field', error: 'format' };
  const challenge = await readMfaChallenge();
  if (!challenge) return { kind: 'screen', screen: 'expired' };
  const r = await mfa.recoverMfa(challenge, code);
  if (!r.ok) return finishMfaLogin(r, 'recovery');
  redirect(safeRedirect(formData.get('redirect') as string | null, '/admin'));
}

// [처음부터 다시 로그인]: 대기표를 버리고 비밀번호 단계로(3.2 보조 링크 2).
export async function restartLogin(): Promise<void> {
  await clearMfaChallenge();
  redirect('/sign-in');
}

// ---- 관리자 2단계 인증 등록, 로그인 중(입구 B, M3 /sign-in/otp-setup, 기획서 3.4·4.4, T-5) ----
// 한 액션이 단계를 옮긴다(intent). 이전 상태에 기대지 않고 폼 값과 서버(enroll/current)만으로 다음 화면을 정한다 —
// JS 없이 제출해도, 새로고침해도 같은 단계가 나온다(T-0 #8).

async function endEnroll(view: SetupView): Promise<SetupView> {
  await clearMfaChallenge();
  return view;
}

async function enrollQrOrExpired(challenge: string, extra: { error?: 'format' | 'wrong' | 'used'; attemptsLeft?: number } = {}): Promise<SetupView> {
  const cur = await mfa.getCurrentEnrollment(challenge);
  if (cur.ok) return { step: 'qr', entry: 'B', qr: qrView(cur.enrollment), rotateDefault: false, ...extra };
  if (cur.reason === 'no_enrollment') return { step: 'qr_expired', entry: 'B' };
  const end = enrollEndOf(cur);
  return end ? endEnroll(end) : { step: 'qr_expired', entry: 'B', notice: noticeOf(cur) };
}

async function startEnrollB(challenge: string, renew: boolean, onFail: SetupView): Promise<SetupView> {
  const r = await mfa.startMfaEnroll({ challenge, renew });
  if (r.ok) return { step: 'qr', entry: 'B', qr: qrView(r.enrollment), rotateDefault: false };
  if (r.reason === 'ticket_not_verified') return { step: 'ticket' };
  const end = enrollEndOf(r);
  if (end) return endEnroll(end);
  return { ...onFail, notice: noticeOf(r) } as SetupView;
}

export async function otpSetupStep(_prev: SetupView, formData: FormData): Promise<SetupView> {
  const intent = formData.get('intent');
  if (intent === 'ack') {
    // 체크 뒤 이동. 보관 확인 기록이 실패해도 이동은 막지 않는다(M6 배너가 다시 알린다, T-5.4).
    await mfa.ackRecoveryCodes();
    redirect(safeRedirect(formData.get('redirect') as string | null, '/admin'));
  }
  if (intent === 'back') return { step: 'prep', entry: 'B' };

  const challenge = await readMfaChallenge();
  if (!challenge) return { step: 'end', screen: 'expired' };

  if (intent === 'next') {
    const cur = await mfa.getCurrentEnrollment(challenge);
    if (cur.ok) return { step: 'qr', entry: 'B', qr: qrView(cur.enrollment), rotateDefault: false };
    if (cur.reason === 'no_enrollment') return cur.ticketVerified ? startEnrollB(challenge, false, { step: 'prep', entry: 'B' }) : { step: 'ticket' };
    const end = enrollEndOf(cur);
    return end ? endEnroll(end) : { step: 'prep', entry: 'B', notice: noticeOf(cur) };
  }

  if (intent === 'ticket') {
    const ticket = normalizeTicket((formData.get('ticket') as string | null) ?? '');
    if (!isTicket(ticket)) return { step: 'ticket', error: 'format' };
    const r = await mfa.checkEnrollTicket(challenge, ticket);
    if (r.ok) return startEnrollB(challenge, false, { step: 'ticket' });
    if (r.reason === 'ticket_invalid') return { step: 'ticket', error: 'wrong', ...(r.attemptsLeft !== undefined ? { attemptsLeft: r.attemptsLeft } : {}) };
    if (r.reason === 'validation') return { step: 'ticket', error: 'format' };
    const end = enrollEndOf(r);
    return end ? endEnroll(end) : { step: 'ticket', notice: noticeOf(r) };
  }

  if (intent === 'renew') return startEnrollB(challenge, true, { step: 'qr_expired', entry: 'B' });

  if (intent === 'confirm') {
    const enrollmentId = ((formData.get('enrollmentId') as string | null) ?? '').trim();
    const code = normalizeOtp((formData.get('code') as string | null) ?? '');
    if (!enrollmentId || !isOtp(code)) return enrollQrOrExpired(challenge, { error: 'format' });
    const r = await mfa.confirmMfaEnroll({ enrollmentId, code, challenge });
    if (r.ok) {
      // 세션은 lib가 이미 썼고 대기표 쿠키는 지웠다. 이 화면(같은 컴포넌트)이 복구 코드를 한 번만 보여 준다.
      if (!r.recoveryCodes?.length) redirect(safeRedirect(formData.get('redirect') as string | null, '/admin'));
      return {
        step: 'codes',
        codes: r.recoveryCodes,
        issuedOn: todayLong(),
        name: await profileNameFor(r.sessionToken, r.userId),
        reason: formData.get('reason') === 'reset' ? 'reenroll' : 'enroll',
      };
    }
    if (r.reason === 'wrong_code') return enrollQrOrExpired(challenge, { error: 'wrong', ...(r.attemptsLeft !== undefined ? { attemptsLeft: r.attemptsLeft } : {}) });
    if (r.reason === 'code_reused') return enrollQrOrExpired(challenge, { error: 'used' });
    if (r.reason === 'validation') return enrollQrOrExpired(challenge, { error: 'format' });
    if (r.reason === 'enrollment_expired' || r.reason === 'not_found' || r.reason === 'no_enrollment' || r.reason === 'unsupported') {
      return { step: 'qr_expired', entry: 'B' };
    }
    const end = enrollEndOf(r);
    if (end) return endEnroll(end);
    const again = await enrollQrOrExpired(challenge);
    return { ...again, notice: noticeOf(r) } as SetupView;
  }

  return { step: 'prep', entry: 'B' };
}

export async function logout() {
  await auth.logout();
  // 자가진단 결과 연결용 쿠키(제출한 브라우저 표시)도 함께 지운다. 공용 기기에서 로그아웃한 뒤 남지 않게(개인정보 점검 R-4).
  // 브라우저 임시 저장 초안(localStorage)은 서버가 못 지우므로 로그아웃 버튼(LogoutForm)이 보내기 전에 지운다.
  try {
    // 현재 경로('/')와 배포 전에 발급된(최대 24시간) 옛 경로('/selfcheck') 둘 다 지운다.
    const jar = await cookies();
    jar.delete({ name: RECENT_SUBMIT_COOKIE, path: '/' });
    jar.delete({ name: RECENT_SUBMIT_COOKIE, path: '/selfcheck' });
  } catch {
    // 쿠키 삭제 실패가 로그아웃을 막으면 안 된다. 값(토큰)은 남기지 않고 한 줄만 기록한다.
    console.error('[logout] selfcheck result cookie delete failed');
  }
  redirect('/');
}

// 재설정 메일 링크(/reset-password?token=)의 토큰은 폼의 hidden input으로 넘어온다.
// 결과는 종류만 돌려주고 문구는 화면이 정한다(카피 문서 4장 RP-*). 비밀번호·토큰은 상태에 담지 않는다.
// short·long·rule: 새 비밀번호 칸 아래, mismatch: 확인 칸 아래, expired: 새 메일 받기 안내, unavailable: 연결 불가(입력 유지).
export async function resetPassword(_prevState: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const token = (formData.get('token') as string | null) ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  const confirm = (formData.get('confirm') as string | null) ?? '';

  if (password.length < 8) return { error: 'short' };
  if (password.length > LIMITS.password) return { error: 'long' };
  if (password !== confirm) return { error: 'mismatch' };
  if (!token) return { error: 'expired' };

  const reset = await auth.resetPassword(token, password);
  if (!reset.ok) {
    if (reset.reason === 'validation' && reset.field === 'password') return { error: 'rule' };
    // 서버 쪽 실패(503·429, 401 서비스 키, 500)는 링크 문제가 아니다. 새 메일을 받아도 똑같이 실패하므로 '잠시 후 다시'로 안내한다.
    if (reset.reason === 'unavailable' || reset.reason === 'failed') return { error: 'unavailable' };
    // invalid_token, 토큰 형식 오류(400 field=token): 새 링크를 받는 것이 해결 방법이다
    return { error: 'expired' };
  }

  redirect('/sign-in?reset=1');
}
