'use client';

import { useEffect, useRef } from 'react';

// 로그인/회원가입 라운드트립이 끝나고 결과 페이지로 돌아왔을 때, "이 브라우저가 방금 이
// 토큰을 제출했다"는 httpOnly 쿠키(RECENT_SUBMIT_COOKIE)가 확인되면 클릭 없이 바로 결과를
// 귀속시킨다(flows.md 1.6.3). ConfirmDialog/FormDialog와 마찬가지로 클라이언트 상태
// (마운트 시점 자동 제출)가 꼭 필요한 예외적 클라이언트 컴포넌트.
export default function AutoClaim({ action }: { action: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.requestSubmit();
  }, []);

  return (
    <form ref={formRef} action={action} hidden>
      <button type="submit" />
    </form>
  );
}
