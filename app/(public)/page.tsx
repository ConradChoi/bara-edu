import ApplyGuideSection from '@/components/home/ApplyGuideSection';
import BrandIntroSection from '@/components/home/BrandIntroSection';
import ComingSoon from '@/components/home/ComingSoon';
import CategorySection from '@/components/home/CategorySection';
import ContactSection from '@/components/home/ContactSection';
import CourseSection from '@/components/home/CourseSection';
import HeroBanner from '@/components/home/HeroBanner';
import RecoveryRedirect from '@/components/auth/RecoveryRedirect';
import { createClient } from '@/lib/supabase/server';

// app/page.tsx에서 이 (public) 그룹으로 옮겨왔다 — 홈도 (public)/layout.tsx의 AppHeader
// (세션에 따라 로그인/마이페이지 전환)와 전역 Footer를 상속받아야 하기 때문이다
// (design.md 4.5.1a). 예전에는 이 라우트가 그룹 밖에 있어 로고만 있는 전용 Header를
// 따로 썼고, 어떤 화면에도 법정 표시사항이 있는 Footer가 노출된 적이 없었다.
export default async function RootPage() {
  const isOpen = process.env.NEXT_PUBLIC_IS_OPEN === 'true';

  if (!isOpen) {
    return (
      <>
        <RecoveryRedirect />
        <ComingSoon />
      </>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <RecoveryRedirect />
      <HeroBanner isLoggedIn={Boolean(user)} />
      <CategorySection />
      <CourseSection />
      <ApplyGuideSection />
      <BrandIntroSection />
      <ContactSection />
    </>
  );
}
