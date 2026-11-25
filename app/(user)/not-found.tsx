import type { Metadata } from 'next';
import NotFoundPanel from '@/components/error/NotFoundPanel';

export const metadata: Metadata = { title: '페이지를 찾을 수 없어요 | 바라 평생교육원' };

// E-404-U: 없는 강의·시험 id. 헤더/푸터는 (user) 레이아웃이 제공한다. 존재 여부를 노출하지 않으려고 "권한 없음"과 같은 404로 통일한다.
export default function UserNotFound() {
  return <NotFoundPanel />;
}
