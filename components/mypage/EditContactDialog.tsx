'use client';

import FormDialog from '@/components/ui/FormDialog';
import { updateContactInfo } from '@/app/actions/account';

// 수강신청 시 등록한 주소/사진 수정(마이페이지 "계정", 2026-09-16). 이름/휴대전화는
// 회원 식별 정보라 여기서 다루지 않는다(대표 요청 — 관리자 문의로만 처리).
export default function EditContactDialog({ defaultAddress, hasPhoto }: { defaultAddress: string | null; hasPhoto: boolean }) {
  return (
    <FormDialog triggerLabel="신청 정보 수정" title="주소·사진 수정" submitLabel="저장" action={updateContactInfo}>
      <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
        주소
        <input
          name="address"
          defaultValue={defaultAddress ?? ''}
          placeholder="수강신청 시 등록한 주소"
          className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
        자격증 발급용 사진 {hasPhoto && <span className="text-n-5">(이미 등록됨 — 새로 올리면 교체돼요)</span>}
        <input
          type="file"
          name="photo"
          accept="image/*"
          className="text-[12.5px] text-n-7 file:mr-3 file:rounded-pill file:border file:border-n-3 file:bg-n-0 file:px-3 file:py-1.5 file:text-[12px] file:font-medium"
        />
      </label>
    </FormDialog>
  );
}
