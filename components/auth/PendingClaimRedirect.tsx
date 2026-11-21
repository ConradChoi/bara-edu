'use client';

import { useEffect } from 'react';

// 도형심리 역량진단(/selfcheck)에서 [회원가입]으로 넘어온 경우, 이메일 인증까지 마친
// 지금이 원래 보던 결과로 되돌아갈 유일한 지점이다 — 가입은 이메일 인증이라는 비동기 왕복을
// 거쳐 ?redirect=를 왕복시키지 못하므로 PendingClaimLink가 남긴 localStorage 힌트로 이어
// 붙인다(flows.md Q10 확정). 7일 넘으면 조용히 무시. (예전 RecoveryRedirect에서 옮겨옴)
export default function PendingClaimRedirect() {
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('bara_selfcheck_pending_claim');
      if (!raw) return;
      window.localStorage.removeItem('bara_selfcheck_pending_claim');
      const pending = JSON.parse(raw) as { token?: string; savedAt?: number };
      const withinSevenDays = typeof pending.savedAt === 'number' && Date.now() - pending.savedAt < 7 * 24 * 60 * 60 * 1000;
      if (pending.token && withinSevenDays) window.location.replace(`/selfcheck/result/${pending.token}`);
    } catch {
      // localStorage 접근 불가(프라이빗 브라우징 등) — 조용히 기본 동작으로 진행.
    }
  }, []);

  return null;
}
