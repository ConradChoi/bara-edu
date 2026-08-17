'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

// Supabase 인증 이메일 링크(비밀번호 재설정 · 회원가입 인증)는 둘 다
// `#access_token=...&type=recovery|signup`를 URL 해시로 실어 Site URL(현재 "/")로
// 리다이렉트한다. 해시는 서버로 전달되지 않아 middleware/서버 컴포넌트에서는 감지할
// 수 없으므로, 클라이언트에서 확인해 처리한다.
// - type=recovery: /reset-password로 넘긴다(해시 유지). 그 페이지의 ResetPasswordForm이 이어서 처리한다.
// - type=signup(2026-08-17, Confirm email 활성화 후 추가): 여기서 바로 setSession()으로
//   세션을 만들고 /my로 보낸다 — 별도 폼 입력이 필요 없어 reset-password와 달리 페이지 이동 없이 끝낸다.
// 링크가 만료·재사용됐을 때는 `#error=access_denied&error_code=otp_expired&...`
// 형태로 온다 — 이 경우도 그냥 Coming Soon/홈으로 흘려보내지 않고 로그인 화면에서
// 안내하도록 리다이렉트한다.
export default function RecoveryRedirect() {
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('type=recovery')) {
      window.location.replace(`/reset-password${hash}`);
    } else if (hash.includes('type=signup')) {
      void establishSignupSession(hash);
    } else if (hash.includes('error=')) {
      window.location.replace('/sign-in?resetError=1');
    }
  }, []);

  return null;
}

async function establishSignupSession(hash: string) {
  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (!accessToken || !refreshToken) {
    window.location.replace('/sign-in?confirmError=1');
    return;
  }

  const supabase = createClient();
  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  window.history.replaceState(null, '', window.location.pathname);

  if (error) {
    window.location.replace('/sign-in?confirmError=1');
    return;
  }
  window.location.replace('/my?welcome=1');
}
