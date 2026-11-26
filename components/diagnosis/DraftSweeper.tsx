'use client';

import { useEffect } from 'react';
import { sweepExpiredDraft } from '@/components/diagnosis/selfcheck-draft';
import { DIAGNOSIS_VERSION } from '@/data/diagnosis/config';

// 공개 화면 어디서 열려도 24시간 지난 자가진단 임시 저장을 지운다(보관은 24시간까지라고 처리방침 제7조에 적었다).
// 화면에는 아무것도 그리지 않는다.
export default function DraftSweeper() {
  useEffect(() => {
    sweepExpiredDraft(DIAGNOSIS_VERSION, Date.now());
  }, []);
  return null;
}
