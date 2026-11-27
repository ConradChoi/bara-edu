'use client';

import { useEffect, useState } from 'react';
import Notice from '@/components/admin/Notice';
import { MFA_COPY as C } from '@/lib/mfa-copy';
import { SESSION_SOON_MS } from '@/lib/mfa-format';

// MFA-SESSION-SOON: 로그아웃 10분 전부터 상단 알림(카피 6장). role=status, 닫기 없음, 포커스 이동 없음.
// 관리자 화면 틀(레이아웃)은 화면 안 이동 때 다시 그려지지 않으므로, 화면을 연 때 받은 남은 시간으로 직접 센다.
const MAX_TIMEOUT = 2_147_483_647;

export default function SessionSoonNotice({ endsInMs }: { endsInMs: number }) {
  const [show, setShow] = useState(endsInMs <= SESSION_SOON_MS);
  useEffect(() => {
    if (show) return;
    const wait = endsInMs - SESSION_SOON_MS;
    if (wait > MAX_TIMEOUT) return;
    const id = setTimeout(() => setShow(true), wait);
    return () => clearTimeout(id);
  }, [endsInMs, show]);
  if (!show) return null;
  return (
    <Notice tone="warning" role="status">
      <p>{C['MFA-SESSION-SOON']}</p>
    </Notice>
  );
}
