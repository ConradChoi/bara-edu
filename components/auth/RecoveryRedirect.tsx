'use client';

import { useEffect } from 'react';

// Supabase 비밀번호 재설정 이메일 링크는 `#access_token=...&type=recovery`를 URL
// 해시로 실어 Site URL(현재 "/")로 리다이렉트한다. 해시는 서버로 전달되지 않아
// middleware/서버 컴포넌트에서는 감지할 수 없으므로, 클라이언트에서 확인해
// /reset-password로 넘긴다(해시 유지). 그 페이지의 ResetPasswordForm이 이어서 처리한다.
// 링크가 만료·재사용됐을 때는 `#error=access_denied&error_code=otp_expired&...`
// 형태로 온다 — 이 경우도 그냥 Coming Soon으로 흘려보내지 않고 로그인 화면에서
// 안내하도록 리다이렉트한다.
export default function RecoveryRedirect() {
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('type=recovery')) {
      window.location.replace(`/reset-password${hash}`);
    } else if (hash.includes('error=')) {
      window.location.replace('/sign-in?resetError=1');
    }
  }, []);

  return null;
}
