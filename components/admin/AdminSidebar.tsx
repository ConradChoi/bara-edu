'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/admin', label: '대시보드' },
  { href: '/admin/enrollments', label: '신청·입금 관리' },
  { href: '/admin/bank-accounts', label: '계좌정보 관리' },
  { href: '/admin/courses', label: '강좌 관리' },
  { href: '/admin/exam-bank', label: '문제은행 관리' },
  { href: '/admin/categories', label: '카테고리 관리' },
  { href: '/admin/members', label: '회원 관리' },
  { href: '/admin/operators', label: '운영자 관리' },
  { href: '/admin/assignments', label: '과제 검토' },
  { href: '/admin/certificates', label: '수료 관리' },
  { href: '/admin/cms', label: '약관·정책 CMS' },
  { href: '/admin/selfcheck', label: '진단 결과 조회' },
  { href: '/admin/selfcheck/leads', label: '강사과정 문의' },
];

// 활성 메뉴 표시를 위해 usePathname()만 쓰는 최소한의 client 컴포넌트
// (이 프로젝트는 client 컴포넌트를 최소화하는 컨벤션이지만, 사이드바 활성 상태 표시는
// 서버 컴포넌트만으로 할 수 없어 예외로 둔다).
// 내 보안 설정(2단계 인증, 기획서 3.5): 옛 API와 함께 도는 동안(경로 없음)은 숨긴다(배포 순서 호환).
const SECURITY_ITEM = { href: '/admin/security', label: '내 보안 설정' };

export default function AdminSidebar({ showSecurity = false }: { showSecurity?: boolean }) {
  const pathname = usePathname();
  const items = showSecurity ? [...NAV_ITEMS, SECURITY_ITEM] : NAV_ITEMS;

  return (
    <nav className="flex w-[200px] shrink-0 flex-col gap-1 border-r border-n-3 bg-n-0 p-4">
      {items.map((item) => {
        // `/admin/selfcheck`와 `/admin/selfcheck/leads`는 중첩 경로라 단순 startsWith면
        // 리드 화면에서 두 메뉴가 동시에 활성 표시된다 — "진단 결과 조회"는 /leads 하위는
        // 제외하도록 별도 처리한다(2026-09-14 추가 시 발견).
        const active =
          item.href === '/admin'
            ? pathname === '/admin'
            : item.href === '/admin/selfcheck'
              ? pathname.startsWith('/admin/selfcheck') && !pathname.startsWith('/admin/selfcheck/leads')
              : pathname.startsWith(item.href);
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
