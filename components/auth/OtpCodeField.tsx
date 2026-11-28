'use client';

import type { Ref } from 'react';
import { INPUT_LG } from '@/components/auth/PasswordField';
import { AlertIcon } from '@/components/error/icons';

// 6자리 번호 칸(디자인 스펙 T-1): 칸 하나, type=text + inputMode=numeric, 자동 제출 없음, placeholder에 기대지 않는 보이는 라벨.
// 붙여넣은 "123 456"·"123-456"은 숫자만 남겨 6자로 자른다. 형식 검사는 폼(onSubmit)과 서버가 한다.
// 입력값을 지울 때(틀림·재사용)는 부모가 key를 바꿔 새로 그린다.
const SIZE = {
  lg: `${INPUT_LG.replace(' pr-[76px]', '')} font-mono text-2xl tabular-nums tracking-[0.3em]`,
  admin:
    'h-12 w-full max-w-[220px] rounded-md border border-n-5 bg-n-0 px-4 font-mono text-xl tabular-nums tracking-[0.3em] text-n-9 outline-none ' +
    'focus:border-indigo focus:ring-2 focus:ring-indigo aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger',
} as const;

export const OTP_LABEL_CLASS = { lg: 'text-base font-semibold text-n-9', admin: 'text-[14px] font-semibold text-n-9' } as const;
export const OTP_HINT_CLASS = { lg: 'text-base leading-[1.6] text-n-7 break-keep', admin: 'text-[13px] leading-[1.6] text-n-6 break-keep' } as const;

export function FieldError({ id, size, children }: { id: string; size: 'lg' | 'admin'; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className={`flex items-start gap-2 ${size === 'lg' ? 'text-base' : 'text-[14px]'} leading-[1.6] text-n-9 break-keep`}>
      <AlertIcon className={`mt-0.5 shrink-0 text-danger-strong ${size === 'lg' ? 'size-5' : 'size-4'}`} />
      <span>{children}</span>
    </p>
  );
}

export default function OtpCodeField({
  id = 'otp-code',
  name = 'code',
  label,
  hint,
  error,
  size = 'lg',
  describedBy,
  inputRef,
  onEdit,
}: {
  id?: string;
  name?: string;
  label: string;
  hint?: string;
  error?: string | null;
  size?: 'lg' | 'admin';
  // 칸 밖 안내 문단 id(예: 화면 안내). 힌트·오류 id는 이 컴포넌트가 붙인다
  describedBy?: string;
  inputRef?: Ref<HTMLInputElement>;
  onEdit?: () => void;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const described = [describedBy, hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={OTP_LABEL_CLASS[size]}>
        {label}
      </label>
      {hint && (
        <p id={hintId} className={OTP_HINT_CLASS[size]}>
          {hint}
        </p>
      )}
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        className={`scroll-mt-20 ${SIZE[size]}`}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          const digits = text.replace(/\D/g, '');
          if (digits && digits !== text) {
            e.preventDefault();
            e.currentTarget.value = digits.slice(0, 6);
            onEdit?.();
          }
        }}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^0-9 ]/g, '');
          if (cleaned !== e.target.value) e.target.value = cleaned;
          onEdit?.();
        }}
      />
      {error && (
        <FieldError id={errorId} size={size}>
          {error}
        </FieldError>
      )}
    </div>
  );
}

