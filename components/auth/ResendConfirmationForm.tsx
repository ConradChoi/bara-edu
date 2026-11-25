'use client';

import { useActionState } from 'react';
import { resendConfirmation, type AuthFormState } from '@/app/actions/auth';

const initialState: AuthFormState = undefined;

export default function ResendConfirmationForm({ defaultEmail }: { defaultEmail?: string }) {
  const [state, formAction, pending] = useActionState(resendConfirmation, initialState);

  if (state && 'pendingConfirmation' in state) {
    return (
      <p className="text-[12px] font-medium text-success">
        <span className="font-semibold">{state.email}</span>로 메일을 보냈어요. 몇 분 안에 오지 않으면 스팸메일함을 확인해 주세요.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="email"
          type="email"
          required
          defaultValue={defaultEmail}
          placeholder="가입한 이메일 주소"
          className="h-10 flex-1 rounded-md border border-n-3 bg-n-1 px-3 text-[13px] text-n-9 outline-none placeholder:text-n-5 focus:border-pink"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-10 shrink-0 rounded-md border border-n-3 px-4 text-[12.5px] font-medium text-n-7 hover:border-indigo hover:text-indigo disabled:opacity-60"
        >
          {pending ? '보내는 중이에요' : '메일 다시 받기'}
        </button>
      </div>
      {state && 'error' in state && <p className="text-[12px] text-danger">{state.error}</p>}
    </form>
  );
}
