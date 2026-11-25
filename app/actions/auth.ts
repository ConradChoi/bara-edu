'use server';

import { redirect } from 'next/navigation';
import * as auth from '@/lib/db/auth';
import { siteConfig } from '@/data/site-config';
import { getSiteOrigin } from '@/lib/site-origin';

// source: 'login'은 인증 전 계정으로 로그인한 경우다 — 메일을 새로 보내지 않았으므로 "메일을 보냈어요" 문구를 쓰면 안 된다.
export type AuthFormState = { error: string } | { pendingConfirmation: true; email: string; source?: 'login' } | undefined;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ?redirect= 값을 검증 없이 그대로 redirect()에 넘기면 오픈 리다이렉트(CWE-601)로
// 피싱에 악용될 수 있다(security-officer 점검, 2026-08-06). 사이트 내부 상대경로만 허용한다.
function safeRedirect(path: string | null): string {
  // WHATWG URL 파서는 `\`를 `/`와 동일하게 취급해 "/\evil.com"이 "//evil.com"(프로토콜
  // 상대 경로)으로 해석될 수 있다 — `//`, `://` 검사만으로는 막히지 않아 `\`도 함께 차단한다.
  if (
    path &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.startsWith('/\\') &&
    !path.includes('://') &&
    !path.includes('\\')
  ) {
    return path;
  }
  return '/my';
}

export async function signup(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const name = (formData.get('name') as string | null)?.trim() ?? '';
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  const phone = (formData.get('phone') as string | null)?.trim() || null;

  if (name.length < 2) return { error: '이름을 2자 이상 입력해 주세요' };
  if (!EMAIL_RE.test(email)) return { error: '올바른 이메일 형식이 아니에요' };
  if (password.length < 8) return { error: '비밀번호는 8자 이상이어야 해요' };
  if (formData.get('agreeTerms') !== 'on' || formData.get('agreePrivacy') !== 'on') {
    return { error: '이용약관과 개인정보 수집·이용에 모두 동의해야 가입할 수 있어요' };
  }

  const r = await auth.signUp({ email, password, name, phone }, await getSiteOrigin());
  if (!r.ok) return { error: '가입 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요' };
  // 신규·이미 가입·미인증 모두 같은 응답이다(이메일 열거 방지, 대표 결정 2026-11-25). 메일 종류는 API가 나눠 보낸다.
  // 가입 직후에는 세션이 없다 — 메일의 /auth/confirm 링크를 눌러야 세션이 생긴다.
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
  if (!EMAIL_RE.test(email)) return { error: '올바른 이메일 형식이 아니에요' };

  if (!(await auth.resend(email, await getSiteOrigin()))) {
    return { error: `메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요. 계속 안 되면 전화로 문의해 주세요. ${siteConfig.phone}` };
  }

  return { pendingConfirmation: true, email };
}

export async function login(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  const redirectTo = safeRedirect(formData.get('redirect') as string | null);

  if (!email || !password) return { error: '이메일과 비밀번호를 입력해 주세요' };

  const r = await auth.login(email, password);
  if (!r.ok) {
    if (r.reason === 'email_not_confirmed') return { pendingConfirmation: true, email, source: 'login' };
    if (r.reason === 'invalid_credentials') return { error: '이메일 또는 비밀번호가 올바르지 않아요' };
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
  if (password !== confirm) return { error: '비밀번호가 일치하지 않아요' };

  if (!token || !(await auth.resetPassword(token, password))) {
    return { error: '비밀번호 변경에 실패했어요. 링크가 만료됐을 수 있어요. 다시 요청해 주세요.' };
  }

  redirect('/sign-in?reset=1');
}
