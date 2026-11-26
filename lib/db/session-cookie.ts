import 'server-only';
import { cookies } from 'next/headers';

const NAME = 'bara_session';

export async function readSession(): Promise<string | null> {
  const store = await cookies();
  return store.get(NAME)?.value ?? null;
}

export async function writeSession(token: string, expiresAt: string): Promise<void> {
  const store = await cookies();
  try {
    store.set(NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: new Date(expiresAt),
    });
  } catch {
    // Server Component에서 호출된 경우 무시 — 쓰기는 Server Action·Route Handler에서만 가능하다.
  }
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  try {
    store.delete(NAME);
  } catch {
    // Server Component에서 호출된 경우 무시.
  }
}

// ---- 2단계 대기표(bara_mfa, 기획서 2.2·4.10) ----
// 비밀번호가 맞은 관리자에게 API가 주는 5분(등록은 15분)짜리 대기표. 세션이 아니라 아무 권한도 없지만
// URL·hidden 필드·localStorage에 두지 않고 httpOnly 쿠키에만 둔다(스크립트가 읽지 못하게).
// Max-Age는 대기표의 남은 시간이라 대기표가 만료되면 브라우저도 쿠키를 버린다.
export const MFA_COOKIE = 'bara_mfa';
const MFA_FALLBACK_SECONDS = 5 * 60;
const MFA_MAX_SECONDS = 15 * 60;

export function mfaCookieMaxAge(expiresAt: string, now = Date.now()): number {
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return MFA_FALLBACK_SECONDS;
  return Math.min(MFA_MAX_SECONDS, Math.max(1, Math.floor((t - now) / 1000)));
}

export async function readMfaChallenge(): Promise<string | null> {
  const store = await cookies();
  return store.get(MFA_COOKIE)?.value || null;
}

export async function writeMfaChallenge(token: string, expiresAt: string): Promise<void> {
  const store = await cookies();
  try {
    store.set(MFA_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: mfaCookieMaxAge(expiresAt),
    });
  } catch {
    // Server Component에서 호출된 경우 무시 — 쓰기는 Server Action에서만 한다.
  }
}

export async function clearMfaChallenge(): Promise<void> {
  const store = await cookies();
  try {
    store.delete(MFA_COOKIE);
  } catch {
    // Server Component에서 호출된 경우 무시.
  }
}
