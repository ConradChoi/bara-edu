import type { Metadata } from 'next';
import NotFoundPanel from '@/components/error/NotFoundPanel';

export const metadata: Metadata = { title: '페이지를 찾을 수 없어요 | 바라 평생교육원' };

// E-404-P: 없는 강좌 slug, 없는 약관 문서 등. 헤더/푸터는 (public) 레이아웃이 제공한다.
export default function PublicNotFound() {
  return <NotFoundPanel />;
}
