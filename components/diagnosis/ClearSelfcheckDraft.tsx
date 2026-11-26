'use client';

import { useEffect } from 'react';
import { DRAFT_KEY } from '@/components/diagnosis/selfcheck-draft';

// 결과 화면을 연 브라우저가 방금 제출한 그 브라우저(httpOnly 쿠키 일치)면 임시 저장 초안을 지운다.
// 스테퍼도 성공 redirect를 보고 지우지만, 이 화면이 실제 성공의 증거라 한 번 더 확실히 지운다(공용 PC에 응답이 남지 않게).
export default function ClearSelfcheckDraft() {
  useEffect(() => {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // localStorage 접근 불가 — 지울 것도 없다.
    }
  }, []);
  return null;
}
