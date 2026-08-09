'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type AuthFormState = { error: string } | undefined;

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

  if (name.length < 2) return { error: '이름을 2자 이상 입력해주세요' };
  if (!EMAIL_RE.test(email)) return { error: '올바른 이메일 형식이 아니에요' };
  if (password.length < 8) return { error: '비밀번호는 8자 이상이어야 해요' };
  if (formData.get('agreeTerms') !== 'on' || formData.get('agreePrivacy') !== 'on') {
    return { error: '이용약관과 개인정보 수집·이용에 모두 동의해야 가입할 수 있어요' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, phone } },
  });

  if (error) {
    return { error: '가입 중 문제가 발생했어요. 잠시 후 다시 시도해주세요' };
  }

  // 이메일 인증을 끈 프로젝트에서는 이미 가입된 이메일로 다시 가입 시도하면
  // 에러 없이 성공한 것처럼 응답하되 identities가 빈 배열로 온다 (Supabase anti-enumeration).
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { error: '이미 가입된 이메일이에요. 로그인해 주세요' };
  }

  redirect('/my');
}

export async function login(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  const redirectTo = safeRedirect(formData.get('redirect') as string | null);

  if (!email || !password) return { error: '이메일과 비밀번호를 입력해주세요' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: '이메일 또는 비밀번호가 올바르지 않아요' };
  }

  redirect(redirectTo);
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
