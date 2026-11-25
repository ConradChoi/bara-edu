'use client';

import Link from 'next/link';
import { SearchIcon } from './icons';
import ErrorTitle from './ErrorTitle';
import { ADMIN_PRIMARY_BTN, ADMIN_TEXT_LINK } from './styles';

// 관리자 404 (E-404-A). AdminShell(사이드바)은 (admin) 레이아웃이 유지하고 main 안에 카드만 그린다. 전화 블록 없음.
// not-found.tsx는 그룹당 1개라 어느 목록에서 났는지 모른다 — 1차는 "관리자 홈으로" 고정, listHref를 주면 "목록으로".
export default function AdminNotFound({ listHref }: { listHref?: string }) {
  return (
    <section aria-labelledby="error-title" className="max-w-[640px] rounded-lg border border-n-3 bg-n-0 p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <SearchIcon className="mt-1 size-6 shrink-0 text-n-6" />
        <div>
          <ErrorTitle className="text-xl font-bold text-n-9 outline-none">찾을 수 없는 항목이에요</ErrorTitle>
          <p className="mt-2 text-[15px] leading-[1.7] text-n-7">삭제됐거나 주소가 잘못됐을 수 있어요.</p>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link href={listHref ?? '/admin'} className={ADMIN_PRIMARY_BTN}>
          {listHref ? '목록으로' : '관리자 홈으로'}
        </Link>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 사이트 홈은 별도 레이아웃이라 전체 이동 */}
        <a href="/" className={ADMIN_TEXT_LINK}>
          사이트 홈
        </a>
      </div>
    </section>
  );
}
