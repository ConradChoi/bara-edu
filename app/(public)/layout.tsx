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

  return (
    <>
      <AppHeader kind={user ? 'user' : 'public'} />
      <main>{children}</main>
      <Footer />
    </>
  );
}
