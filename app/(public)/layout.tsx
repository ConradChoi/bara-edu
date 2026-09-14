import AppHeader from '@/components/layout/AppHeader';
import Footer from '@/components/layout/Footer';
import { createClient } from '@/lib/supabase/server';

// (public) 그룹은 비로그인 방문자와 로그인한 회원이 모두 드나든다(홈/강좌목록/강좌상세).
// kind를 라우트 그룹으로 고정하면 로그인 상태에서도 "로그인" 버튼이 뜨는 버그가 생기므로
// 세션을 확인해 실제 로그인 여부에 따라 GNB를 전환한다.
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 헤더/푸터는 print-hide로 감싼다 — 이 그룹 안의 /selfcheck/result 인쇄 기능(F-DIAG-16)이
  // "점수·차트·해석만 인쇄"를 요구하는데, 이 프로젝트 최초의 인쇄 화면이라 지금까지는
  // 이 레이아웃 어디에도 해당 처리가 없었다(qa-reviewer 지적). 다른 (public) 페이지는
  // window.print()를 쓰지 않아 영향 없다.
  return (
    <>
      <div className="print-hide">
        <AppHeader kind={user ? 'user' : 'public'} />
      </div>
      <main>{children}</main>
      <div className="print-hide">
        <Footer />
      </div>
    </>
  );
}
