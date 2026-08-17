'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { signup, login, type AuthFormState } from '@/app/actions/auth';
import ResendConfirmationForm from '@/components/auth/ResendConfirmationForm';

const initialState: AuthFormState = undefined;

type AuthFormProps = {
  mode: 'signup' | 'signin';
  redirectTo?: string;
};

export default function AuthForm({ mode, redirectTo }: AuthFormProps) {
  const action = mode === 'signup' ? signup : login;
  const [state, formAction, pending] = useActionState(action, initialState);

  if (mode === 'signup' && state && 'pendingConfirmation' in state) {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-[14px] leading-relaxed text-n-7">
          <span className="font-semibold text-n-9">{state.email}</span>로 인증 메일을 보내드렸어요. 메일함에서 링크를 눌러
          가입을 완료해주세요.
        </p>
        <div className="flex flex-col gap-2 border-t border-n-3 pt-4">
          <p className="text-[12.5px] text-n-6">메일이 안 왔거나 링크가 만료됐다면 다시 보낼 수 있어요.</p>
          <ResendConfirmationForm defaultEmail={state.email} />
        </div>
        <Link href="/sign-in" className="text-center text-[13px] font-medium text-pink">
          로그인 화면으로
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {mode === 'signup' && (
        <Field label="이름" name="name" placeholder="이름을 입력하세요" required />
      )}
      <Field
        label="이메일"
        name="email"
        type="email"
        placeholder="name@example.com"
        required
      />
      <Field
        label="비밀번호"
        name="password"
        type="password"
        placeholder={mode === 'signup' ? '8자 이상 입력하세요' : '비밀번호를 입력하세요'}
        required
      />
      {mode === 'signup' && <Field label="연락처" name="phone" placeholder="010-0000-0000" />}
      {mode === 'signup' && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[12.5px] text-n-7">
            <input type="checkbox" name="agreeTerms" required className="h-4 w-4" />
            <Link href="/legal/terms" target="_blank" className="underline">
              이용약관
            </Link>
            에 동의합니다 (필수)
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-n-7">
            <input type="checkbox" name="agreePrivacy" required className="h-4 w-4" />
            <Link href="/legal/privacy" target="_blank" className="underline">
              개인정보 수집·이용
            </Link>
            에 동의합니다 (필수)
          </label>
        </div>
      )}
      {mode === 'signin' && redirectTo && (
        <input type="hidden" name="redirect" value={redirectTo} />
      )}

      {state && 'error' in state && <p className="text-[12.5px] text-danger">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="h-[46px] rounded-pill bg-pink text-[14px] font-semibold text-white disabled:opacity-60"
      >
        {pending ? '처리 중...' : mode === 'signup' ? '가입하기' : '로그인'}
      </button>

      <p className="text-center text-[12px] text-n-6">
        {mode === 'signup' ? (
          <>
            이미 계정이 있으신가요?{' '}
            <Link href="/sign-in" className="font-medium text-pink">
              로그인
            </Link>
          </>
        ) : (
          <>
            계정이 없으신가요?{' '}
            <Link href="/sign-up" className="font-medium text-pink">
              회원가입
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px]">
      <span className="text-n-7">
        {label}
        {required && ' *'}
      </span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        className="h-11 rounded-md border border-n-3 bg-n-1 px-3 text-[13px] text-n-9 outline-none placeholder:text-n-5 focus:border-pink"
      />
    </label>
  );
}
