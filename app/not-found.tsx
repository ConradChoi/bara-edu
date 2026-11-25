import type { Metadata } from 'next';
import ErrorHeader from '@/components/layout/ErrorHeader';
import FooterBody from '@/components/layout/FooterBody';
import NotFoundPanel from '@/components/error/NotFoundPanel';

export const metadata: Metadata = { title: '페이지를 찾을 수 없어요 | 바라 평생교육원' };

// E-404-R: 정의되지 않은 주소, 그리고 그룹별 not-found가 없는 곳. 루트 레이아웃에는 헤더가 없으므로 간이 헤더·푸터를 직접 그린다.
// 세션·API 조회 없음(FooterBody도 조회 없는 순수 컴포넌트) — API가 죽어도 404는 항상 뜬다.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <ErrorHeader />
      <main id="main" className="flex-1">
        <NotFoundPanel hardLinks />
      </main>
      <FooterBody />
    </div>
  );
}
