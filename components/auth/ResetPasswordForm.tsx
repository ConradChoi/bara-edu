'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { resetPassword, type AuthFormState } from '@/app/actions/auth';

const initialState: AuthFormState = undefined;

export default function ResetPasswordForm({ token }: { token?: string }) {
  const [state, formAction, pending] = useActionState(resetPassword, initialState);

  if (!token) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-danger">링크가 올바르지 않아요. 재설정 이메일을 다시 요청해 주세요.</p>
        <Link href="/sign-in" className="text-[12.5px] font-medium text-pink">
          로그인 화면으로
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1.5 text-[13px]">
        <span className="text-n-7">새 비밀번호</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          placeholder="8자 이상 입력하세요"
          className="h-11 rounded-md border border-n-3 bg-n-1 px-3 text-[13px] text-n-9 outline-none placeholder:text-n-5 focus:border-pink"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px]">
        <span className="text-n-7">새 비밀번호 확인</span>
        <input
          name="confirm"
          type="password"
          required
          minLength={8}
          className="h-11 rounded-md border border-n-3 bg-n-1 px-3 text-[13px] text-n-9 outline-none placeholder:text-n-5 focus:border-pink"
        />
      </label>

      {state && 'error' in state && <p className="text-[12.5px] text-danger">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="h-[46px] rounded-pill bg-pink text-[14px] font-semibold text-white disabled:opacity-60"
      >
        {pending ? '변경 중...' : '비밀번호 변경'}
      </button>
    </form>
  );
}
