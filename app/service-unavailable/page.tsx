import type { Metadata } from 'next';
import ErrorHeader from '@/components/layout/ErrorHeader';
import FooterBody from '@/components/layout/FooterBody';
import UnavailablePanel from '@/components/error/UnavailablePanel';

export const metadata: Metadata = {
  title: '연결이 원활하지 않아요 | 바라 평생교육원',
  robots: { index: false, follow: false },
};

// E-503: API 연결 불가 전체 화면. proxy.ts가 보호 경로(/my, /learn, /admin)에서 API에 닿지 못하면 이 페이지로 rewrite하고
// 503을 유지한다. API·세션·DB를 일절 부르지 않는다 — 그래서 (public) 그룹(레이아웃이 세션과 환불정책을 조회)이 아니라 루트에 둔다.
export default function ServiceUnavailablePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <ErrorHeader />
      <main id="main" className="flex-1">
        <UnavailablePanel />
      </main>
      <FooterBody />
    </div>
  );
}
