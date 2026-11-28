import Link from 'next/link';
import { logout } from '@/app/actions/auth';
import LogoutForm from '@/components/layout/LogoutForm';

type AppHeaderProps = {
  kind: 'public' | 'user';
};

// Figma "AppHeader" 컴포넌트(Kind=Public/User)와 1:1 대응.
// 근거: docs/01-plan/features/bara-edu-lms.menu-features.md 1.1
// 메뉴 글자 15px(시니어 가독성, 홈 QA Minor 2026-11-28). 360px 미만 화면만 14px.
// 좁은 화면에서 줄바꿈·넘침이 없도록 모바일은 여백·간격을 줄이고, 빈 칸 요소 대신 ml-auto로 오른쪽 끝에 붙인다
// (빈 칸에도 gap이 붙어 로그인 후 헤더가 320px에서 넘쳤다). 운영 화면에 대입해 public·user 헤더를 320·340·360px에서 측정.
export default function AppHeader({ kind }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex h-[57px] items-center gap-4 border-b border-n-3 bg-n-0 px-4 sm:gap-6 sm:px-6">
      <Link href="/" className="whitespace-nowrap text-sm font-semibold text-indigo">
        바라 평생교육원
      </Link>
      <nav className="flex items-center gap-3 sm:gap-[18px]">
        <Link href="/courses" className="whitespace-nowrap text-[14px] min-[360px]:text-[15px] text-n-7">
          강좌안내
        </Link>
        {kind === 'user' ? (
          <Link href="/my" className="whitespace-nowrap text-[14px] min-[360px]:text-[15px] text-n-7">
            마이페이지
          </Link>
        ) : (
          <Link href="/#apply-guide" className="whitespace-nowrap text-[14px] min-[360px]:text-[15px] text-n-7">
            신청방법
          </Link>
        )}
      </nav>
      {kind === 'user' ? (
        <LogoutForm action={logout} className="ml-auto">
          <button type="submit" className="whitespace-nowrap text-[14px] min-[360px]:text-[15px] text-n-6">
            로그아웃
          </button>
        </LogoutForm>
      ) : (
        <Link href="/sign-in" className="ml-auto whitespace-nowrap text-[14px] min-[360px]:text-[15px] text-n-6">
          로그인
        </Link>
      )}
    </header>
  );
}
