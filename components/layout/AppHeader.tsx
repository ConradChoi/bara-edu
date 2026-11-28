import Link from 'next/link';
import { logout } from '@/app/actions/auth';
import LogoutForm from '@/components/layout/LogoutForm';

type AppHeaderProps = {
  kind: 'public' | 'user';
};

// Figma "AppHeader" 컴포넌트(Kind=Public/User)와 1:1 대응.
// 근거: docs/01-plan/features/bara-edu-lms.menu-features.md 1.1
// 메뉴 글자 15px(시니어 가독성, 홈 QA Minor 2026-11-28). 좁은 화면(320~360px)에서 줄바꿈·넘침이 없도록
// 모바일만 좌우 여백과 간격을 줄이고 whitespace-nowrap을 건다(운영 화면에 대입해 320·360px 측정).
export default function AppHeader({ kind }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex h-[57px] items-center gap-4 border-b border-n-3 bg-n-0 px-4 sm:gap-6 sm:px-6">
      <Link href="/" className="whitespace-nowrap text-sm font-semibold text-indigo">
        바라 평생교육원
      </Link>
      <nav className="flex items-center gap-3.5 sm:gap-[18px]">
        <Link href="/courses" className="whitespace-nowrap text-[15px] text-n-7">
          강좌안내
        </Link>
        {kind === 'user' ? (
          <Link href="/my" className="whitespace-nowrap text-[15px] text-n-7">
            마이페이지
          </Link>
        ) : (
          <Link href="/#apply-guide" className="whitespace-nowrap text-[15px] text-n-7">
            신청방법
          </Link>
        )}
      </nav>
      <div className="flex-1" />
      {kind === 'user' ? (
        <LogoutForm action={logout}>
          <button type="submit" className="whitespace-nowrap text-[15px] text-n-6">
            로그아웃
          </button>
        </LogoutForm>
      ) : (
        <Link href="/sign-in" className="whitespace-nowrap text-[15px] text-n-6">
          로그인
        </Link>
      )}
    </header>
  );
}
