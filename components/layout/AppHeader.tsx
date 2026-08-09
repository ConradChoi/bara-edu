import Link from 'next/link';
import { logout } from '@/app/actions/auth';

type AppHeaderProps = {
  kind: 'public' | 'user';
};

// Figma "AppHeader" 컴포넌트(Kind=Public/User)와 1:1 대응.
// 근거: docs/01-plan/features/bara-edu-lms.menu-features.md 1.1
export default function AppHeader({ kind }: AppHeaderProps) {
  return (
    <header className="flex h-[57px] items-center gap-6 border-b border-n-3 bg-n-0 px-6">
      <Link href="/" className="text-sm font-semibold text-indigo">
        바라 평생교육원
      </Link>
      <nav className="flex items-center gap-[18px]">
        <Link href="/courses" className="text-[12.5px] text-n-7">
          강좌안내
        </Link>
        {kind === 'user' ? (
          <Link href="/my" className="text-[12.5px] text-n-7">
            마이페이지
          </Link>
        ) : (
          <Link href="/#apply-guide" className="text-[12.5px] text-n-7">
            신청방법
          </Link>
        )}
      </nav>
      <div className="flex-1" />
      {kind === 'user' ? (
        <form action={logout}>
          <button type="submit" className="text-[12.5px] text-n-6">
            로그아웃
          </button>
        </form>
      ) : (
        <Link href="/sign-in" className="text-[12.5px] text-n-6">
          로그인
        </Link>
      )}
    </header>
  );
}
