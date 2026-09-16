'use client';

import FormDialog from '@/components/ui/FormDialog';
import { changePassword } from '@/app/actions/account';

// 로그인 비밀번호 변경(마이페이지 "계정", 2026-09-16). 현재 비밀번호 재확인은
// app/actions/account.ts의 changePassword()가 서버에서 강제한다 — 여기서는 형식만
// 안내(8자 이상, 새 비밀번호 확인 일치)하고 실제 검증은 서버가 한다.
export default function ChangePasswordDialog() {
  return (
    <FormDialog triggerLabel="비밀번호 변경" title="비밀번호 변경" submitLabel="변경" action={changePassword}>
      <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
        현재 비밀번호 *
        <input
          type="password"
          name="currentPassword"
          required
          className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
        새 비밀번호 *
        <input
          type="password"
          name="newPassword"
          required
          minLength={8}
          placeholder="8자 이상"
          className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
        새 비밀번호 확인 *
        <input
          type="password"
          name="confirmPassword"
          required
          minLength={8}
          className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
        />
      </label>
    </FormDialog>
  );
}
