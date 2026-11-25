'use client';

import { LEAD_NOTE_PII_MESSAGE, leadNoteHasPii } from '@/lib/admin-profile-edit';

// 강사과정 문의 메모 입력 칸. 개인정보 패턴이 있으면 브라우저 검증으로 제출을 막는다(서버 액션·API도 같은 규칙으로 다시 검사).
export default function LeadNoteTextarea({ defaultValue }: { defaultValue: string }) {
  return (
    <textarea
      name="note"
      defaultValue={defaultValue}
      onChange={(e) => e.currentTarget.setCustomValidity(leadNoteHasPii(e.currentTarget.value) ? LEAD_NOTE_PII_MESSAGE : '')}
      className="min-h-[80px] rounded-md border border-n-3 bg-n-1 p-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
    />
  );
}
