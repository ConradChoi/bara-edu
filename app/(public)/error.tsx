'use client';

import ErrorPanel from '@/components/error/ErrorPanel';

// E-500-U: (public) 그룹 화면의 렌더링 예외. 헤더/푸터는 그룹 레이아웃이 유지한다.
export default function PublicError(props: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ErrorPanel {...props} />;
}
