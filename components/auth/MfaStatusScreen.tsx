'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { STATUS_TITLE_CLASS } from '@/components/auth/styles';
import { ACTIONS_CLASS } from '@/components/error/styles';

// 로그인 중 2단계 화면의 상태 화면(폼 대체, 디자인 스펙 T-3.3): 원형 아이콘 → 제목(tabIndex -1) → 본문 → 액션.
// 액션 결과로 바뀌었을 때만 제목으로 포커스를 옮긴다(첫 진입은 autofocus 금지, T-8).
export default function MfaStatusScreen({
  icon,
  title,
  children,
  actions,
  focus,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  actions: ReactNode;
  focus: boolean;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <section aria-labelledby="mfa-status-title">
      <div className="flex size-14 items-center justify-center rounded-pill bg-n-1" aria-hidden="true">
        {icon}
      </div>
      <h1 id="mfa-status-title" ref={ref} tabIndex={-1} className={STATUS_TITLE_CLASS}>
        {title}
      </h1>
      {children && <div className="mt-3 flex flex-col gap-2 text-base leading-[1.7] text-n-7 break-keep">{children}</div>}
      <div className={ACTIONS_CLASS.replace(' md:max-w-[420px]', '')}>{actions}</div>
    </section>
  );
}
