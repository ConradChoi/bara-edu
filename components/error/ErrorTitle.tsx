'use client';

import { useEffect, useRef } from 'react';
import { TITLE_CLASS } from './styles';

// 오류 화면이 뜨면 포커스를 제목으로 옮겨 스크린리더가 상황을 바로 읽게 한다(정의서 3.6).
// 서버 컴포넌트인 not-found 본문은 포커스를 직접 못 주므로 이 작은 클라이언트 컴포넌트가 맡는다.
export default function ErrorTitle({ children, className = TITLE_CLASS }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h1 id="error-title" ref={ref} tabIndex={-1} className={className}>
      {children}
    </h1>
  );
}
