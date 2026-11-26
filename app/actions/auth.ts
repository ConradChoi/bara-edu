'use server';

import { redirect } from 'next/navigation';
import * as auth from '@/lib/db/auth';
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

function safeRedirect(path: string | null): string {
  if (!path || path.length > MAX_REDIRECT_LENGTH) return FALLBACK_REDIRECT;
  if (UNSAFE_REDIRECT_CHARS.test(path)) return FALLBACK_REDIRECT;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) return FALLBACK_REDIRECT;
  try {
    const base = 'http://redirect-check.invalid';
    if (new URL(path, base).origin !== base) return FALLBACK_REDIRECT;
  } catch {
    return FALLBACK_REDIRECT;
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

  redirect(redirectTo);
}

export async function logout() {
  await auth.logout();
  redirect('/');
}

// 재설정 메일 링크(/reset-password?token=)의 토큰은 폼의 hidden input으로 넘어온다.
export async function resetPassword(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const token = (formData.get('token') as string | null) ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  const confirm = (formData.get('confirm') as string | null) ?? '';

  if (password.length < 8) return { error: '비밀번호는 8자 이상이어야 해요' };
  if (password.length > LIMITS.password) return { error: `비밀번호는 ${LIMITS.password}자 이하로 입력해 주세요` };
  if (password !== confirm) return { error: '비밀번호가 일치하지 않아요' };

  const reset = token ? await auth.resetPassword(token, password) : ({ ok: false, field: undefined } as const);
  if (!reset.ok) {
    if (reset.field === 'password') return { error: FIELD_MESSAGES.password };
    return { error: '비밀번호 변경에 실패했어요. 링크가 만료됐을 수 있어요. 다시 요청해 주세요.' };
  }

  redirect('/sign-in?reset=1');
}
