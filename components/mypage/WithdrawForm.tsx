'use client';

import FormDialog from '@/components/ui/FormDialog';
import { WITHDRAWAL_REASONS } from '@/data/account-settings';

// 탈퇴 사유 선택(필수) + 서술(선택) 없이 곧바로 탈퇴되지 않아야 한다는 대표 요청
// (2026-09-16)에 따라 기존 confirm() 한 번짜리 폼을 FormDialog로 교체했다. 파일명은
// import 경로를 바꾸지 않기 위해 그대로 WithdrawForm으로 유지한다.
export default function WithdrawForm({ action }: { action: (formData: FormData) => void | Promise<void> }) {
  return (
    <FormDialog
      triggerLabel="회원 탈퇴"
      triggerClassName="rounded-pill border border-danger px-3.5 py-1.5 text-[12.5px] font-medium text-danger"
      title="정말 탈퇴하시겠어요?"
      submitLabel="탈퇴"
      tone="danger"
      action={action}
    >
      <p className="text-[12px] text-n-6">이 작업은 되돌릴 수 없어요. 탈퇴 사유를 알려주시면 서비스 개선에 참고할게요.</p>
      <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
        탈퇴 사유 *
        <select
          name="reason"
          required
          defaultValue=""
          className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
        >
          <option value="" disabled>
            선택해주세요
          </option>
          {WITHDRAWAL_REASONS.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
        자세한 사유 (선택)
        <textarea
          name="detail"
          placeholder="더 나은 서비스를 위해 남겨주시면 큰 도움이 돼요"
          className="min-h-[72px] rounded-md border border-n-3 bg-n-1 p-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
        />
      </label>
    </FormDialog>
  );
}
