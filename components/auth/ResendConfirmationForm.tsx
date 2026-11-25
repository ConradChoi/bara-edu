'use client';

import { useActionState, useEffect, useRef } from 'react';
import { resendConfirmation, type AuthFormState } from '@/app/actions/auth';
import { CheckIcon, AlertIcon } from '@/components/error/icons';
import { FOCUS_RING, INPUT_LG } from '@/components/auth/PasswordField';

const initialState: AuthFormState = undefined;

// size="lg": 가입 마무리의 만료·무효 화면용(디자인 스펙 V-2.4). 기본값 md는 기존 마크업 그대로다.
export default function ResendConfirmationForm({ defaultEmail, size = 'md' }: { defaultEmail?: string; size?: 'md' | 'lg' }) {
  const [state, formAction, pending] = useActionState(resendConfirmation, initialState);
  const doneRef = useRef<HTMLDivElement>(null);
  const sent = Boolean(state && 'pendingConfirmation' in state);
  useEffect(() => {
    if (sent && size === 'lg') doneRef.current?.focus();
  }, [sent, size]);

  if (size === 'lg') {
    if (state && 'pendingConfirmation' in state) {
      return (
        <div ref={doneRef} tabIndex={-1} aria-live="polite" className="flex gap-3 rounded-md bg-n-1 px-4 py-3 text-base leading-[1.6] text-n-9 outline-none">
          <CheckIcon className="mt-0.5 size-6 shrink-0 text-success" />
          <div className="flex flex-col gap-2 break-keep">
            <p>
              <span className="break-all font-semibold">{state.email}</span>로 메일을 보냈어요. 몇 분 안에 오지 않으면 스팸메일함을 확인해 주세요.
            </p>
            <p>메일이 오지 않으면 아래에서 처음부터 다시 가입해 주세요.</p>
          </div>
        </div>
      );
    }
    const err = state && 'error' in state ? state.error : null;
    return (
      <form action={formAction} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="resend-email" className="text-base font-semibold text-n-9">
            가입한 이메일
          </label>
          <input
            id="resend-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            defaultValue={defaultEmail}
            aria-invalid={err ? true : undefined}
            aria-describedby={err ? 'resend-email-error' : undefined}
            className={INPUT_LG.replace(' pr-[76px]', '')}
          />
        </div>
        {err && (
          <p id="resend-email-error" className="flex gap-3 rounded-md border-l-4 border-danger bg-n-1 px-4 py-3 text-base leading-[1.6] text-n-9 break-keep">
            <AlertIcon className="mt-0.5 size-6 shrink-0 text-danger" />
            {err}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className={`inline-flex min-h-14 w-full items-center justify-center rounded-pill bg-indigo px-6 text-lg font-bold text-n-0 hover:bg-arc-1 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
        >
          {pending ? '보내는 중이에요' : '메일 다시 받기'}
        </button>
      </form>
    );
  }

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
