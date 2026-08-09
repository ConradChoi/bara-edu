'use client';

import Link from 'next/link';

type HeaderProps = {
  showNav?: boolean;
};

// Coming Soon 전용 최소 헤더. 강좌목록/로그인 등 실제 라우트가 열리기 전까지는
// AppHeader(로그인 링크·강좌안내 nav 포함) 대신 이 로고 전용 버전을 쓴다.
export default function Header({ showNav = true }: HeaderProps) {
  return (
    <header className="relative z-10 flex h-16 w-full items-center justify-between border-b border-n-3 bg-n-0 px-6 md:px-16 lg:px-[120px]">
      <Link href="/" className="font-bold" style={{ textDecoration: 'none' }}>
        <span className="text-[18px] font-bold text-n-9">바라 평생교육원</span>
      </Link>

      {showNav && (
        <nav>
          <ul className="m-0 flex list-none gap-6 p-0">
            {[
              { label: '강좌 안내', href: '/courses' },
              { label: '수강 신청', href: '/courses' },
            ].map(({ label, href }) => (
              <li key={label}>
                <Link href={href} className="text-[14px] font-medium text-n-6" style={{ textDecoration: 'none' }}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
