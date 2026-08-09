'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/admin', label: '대시보드' },
  { href: '/admin/enrollments', label: '신청·입금 관리' },
  { href: '/admin/courses', label: '강좌 관리' },
  { href: '/admin/categories', label: '카테고리 관리' },
  { href: '/admin/members', label: '회원 관리' },
  { href: '/admin/assignments', label: '과제 검토' },
  { href: '/admin/certificates', label: '수료 관리' },
  { href: '/admin/cms', label: '약관·정책 CMS' },
];

// 활성 메뉴 표시를 위해 usePathname()만 쓰는 최소한의 client 컴포넌트
// (이 프로젝트는 client 컴포넌트를 최소화하는 컨벤션이지만, 사이드바 활성 상태 표시는
// 서버 컴포넌트만으로 할 수 없어 예외로 둔다).
export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex w-[200px] shrink-0 flex-col gap-1 border-r border-n-3 bg-n-0 p-4">
      {NAV_ITEMS.map((item) => {
        const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-2 text-[13px] font-medium ${active ? 'bg-indigo/10 text-indigo' : 'text-n-6'}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
