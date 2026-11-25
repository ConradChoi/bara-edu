'use client';

import type { ChangeEventHandler, FocusEventHandler, Ref } from 'react';

// 가입 폼 비밀번호 두 칸과 가입 마무리 비밀번호 칸이 함께 쓰는 입력(디자인 스펙 V-1.2).
// 보기/숨기기 상태(shown)는 부모가 들고 있다 — 가입 폼은 두 칸이 같은 상태를 공유한다(대표 판단).
// 토글은 글자("보기"/"숨기기")로만 둔다. 눈 아이콘은 시니어에게 의미가 안 읽힌다.
export const FOCUS_RING = 'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-indigo';
export const INPUT_LG =
  'h-14 w-full rounded-md border border-n-5 bg-n-0 px-4 pr-[76px] text-base text-n-9 outline-none placeholder:text-n-6 ' +
  'focus:border-indigo focus:ring-2 focus:ring-indigo aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger';

export type PasswordFieldProps = {
  id: string;
  name: string;
  label: string;
  hint?: string;
  shown: boolean;
  onToggle: () => void;
  // 스크린리더용 토글 이름(보이는 글자와 별개). 예: "비밀번호" -> "비밀번호 보기" / "비밀번호 숨기기"
  toggleName: string;
  // 토글이 바꾸는 입력의 id들(공유 토글이면 둘 다)
  controls?: string;
  autoComplete: 'new-password' | 'current-password';
  required?: boolean;
  maxLength?: number;
  invalid?: boolean;
  describedBy?: string;
  value?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  ref?: Ref<HTMLInputElement>;
};

export default function PasswordField({ ref, ...p }: PasswordFieldProps) {
  const hintId = p.hint ? `${p.id}-hint` : undefined;
  const describedBy = [hintId, p.describedBy].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={p.id} className="text-base font-semibold text-n-9">
        {p.label}
        {p.required && <span aria-hidden="true"> *</span>}
      </label>
      {p.hint && (
        <p id={hintId} className="text-sm leading-[1.6] text-n-6 break-keep">
          {p.hint}
        </p>
      )}
      <div className="relative">
        <input
          ref={ref}
          id={p.id}
          name={p.name}
          type={p.shown ? 'text' : 'password'}
          autoComplete={p.autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required={p.required}
          maxLength={p.maxLength}
          aria-invalid={p.invalid ? true : undefined}
          aria-describedby={describedBy}
          value={p.value}
          onChange={p.onChange}
          onBlur={p.onBlur}
          className={INPUT_LG}
        />
        <button
          type="button"
          onClick={p.onToggle}
          aria-controls={p.controls ?? p.id}
          aria-label={`${p.toggleName} ${p.shown ? '숨기기' : '보기'}`}
          className={`absolute right-1 top-1/2 inline-flex h-12 min-w-[60px] -translate-y-1/2 items-center justify-center rounded-md px-3 text-base font-semibold text-indigo hover:bg-n-1 ${FOCUS_RING}`}
        >
          {p.shown ? '숨기기' : '보기'}
        </button>
      </div>
    </div>
  );
}
