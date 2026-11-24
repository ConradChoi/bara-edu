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
