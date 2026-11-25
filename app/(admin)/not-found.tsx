import type { Metadata } from 'next';
import AdminNotFound from '@/components/error/AdminNotFound';

export const metadata: Metadata = { title: '찾을 수 없는 항목이에요 | 바라 평생교육원' };

// E-404-A: 없는 회원/강좌/문서 id. AdminShell(사이드바)은 (admin) 레이아웃이 유지한다.
export default function AdminGroupNotFound() {
  return <AdminNotFound />;
}
