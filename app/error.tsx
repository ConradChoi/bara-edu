'use client';

import ErrorPanel from '@/components/error/ErrorPanel';
import ErrorHeader from '@/components/layout/ErrorHeader';
import FooterBody from '@/components/layout/FooterBody';

// E-500-R: 그룹 레이아웃(헤더·푸터·AdminShell)이 던진 예외와, 그룹별 error.tsx가 없는 (auth) 그룹의 예외를 받는 마지막 폴백.
// error.tsx는 같은 세그먼트의 layout을 감싸지 못하므로 이 화면이 간이 헤더·푸터를 직접 그린다(세션·API 조회 없음).
// 관리자 레이아웃이 던진 예외도 여기로 오므로 사용자용 문구를 쓰고, 문의번호는 보이지 않는다.
export default function RootError(props: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <div className="flex min-h-screen flex-col">
      <ErrorHeader />
      <main id="main" className="flex-1">
        <ErrorPanel {...props} />
      </main>
      <FooterBody />
    </div>
  );
}
