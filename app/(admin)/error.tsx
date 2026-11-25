'use client';

import AdminErrorPanel from '@/components/error/AdminErrorPanel';

// E-500-A: 관리자 화면의 렌더링 예외. AdminShell(사이드바)은 유지되고 main 안에 경로·시각·문의번호가 보인다.
export default function AdminError(props: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <AdminErrorPanel {...props} />;
}
