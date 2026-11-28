'use client';

import { clearSelfcheckDraft } from '@/components/diagnosis/selfcheck-draft';

// 로그아웃 버튼 폼. 서버 액션(logout)이 세션과 결과 연결 쿠키를 지우고, 이 폼은 보내기 전에
// 브라우저 임시 저장 초안(localStorage)을 지운다 — 공용 기기에 이름·연락처 초안이 남지 않게(개인정보 점검 R-4).
export default function LogoutForm({
  action,
  children,
  className,
}: {
  action: () => void | Promise<void>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <form action={action} onSubmit={clearSelfcheckDraft} className={className}>
      {children}
    </form>
  );
}
