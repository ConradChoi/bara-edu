'use client';

import { useEffect, useState } from 'react';
import Notice from '@/components/admin/Notice';
import { MFA_COPY as C } from '@/lib/mfa-copy';
import { SESSION_SOON_MS } from '@/lib/mfa-format';

// MFA-SESSION-SOON: 로그아웃 10분 전부터 상단 알림(카피 6장). role=status, 닫기 없음, 포커스 이동 없음.
// 관리자 화면 틀(레이아웃)은 화면 안 이동 때 다시 그려지지 않으므로, 화면을 연 때 받은 남은 시간으로 직접 센다.
// 노트북 절전·뒤 탭에서는 타이머가 늦게 울리므로(QA I-1) 받은 순간의 마감 시각을 고정해 두고
// 30초마다, 그리고 탭이 다시 보이거나 창에 돌아올 때 마감 시각과 비교한다(PC 시계의 절대값이 아니라 흐른 시간만 쓴다).
const CHECK_MS = 30_000;

export default function SessionSoonNotice({ endsInMs }: { endsInMs: number }) {
  const [show, setShow] = useState(endsInMs <= SESSION_SOON_MS);
  useEffect(() => {
    if (show) return;
    const warnAt = Date.now() + endsInMs - SESSION_SOON_MS;
    const check = () => {
      if (Date.now() >= warnAt) setShow(true);
    };
    const id = setInterval(check, CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, [endsInMs, show]);
  if (!show) return null;
  return (
    <Notice tone="warning" role="status">
      <p>{C['MFA-SESSION-SOON']}</p>
    </Notice>
  );
}
