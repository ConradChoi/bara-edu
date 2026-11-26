'use client';

import { useId, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { LEAD_NOTE_PII_MESSAGE, leadNoteHasPii } from '@/lib/admin-profile-edit';

type ConfirmDialogProps = {
  triggerLabel: string;
  triggerClassName?: string;
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: 'neutral' | 'danger';
  // 'lg': 관리자 기준(버튼 48px, 글자 15px). 기본값은 기존과 같다.
  size?: 'md' | 'lg';
  cancelLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
  action: (formData: FormData) => void | Promise<void>;
  // required 기본값 true(기존 호출부 전부 사유 필수) — "연락함으로 표시"처럼 선택 메모가
  // 필요한 곳만 false로 낮춘다(도형심리 진단 관리자 리드 화면, 2026-09-14 추가).
  // checkPii: 입력에 이름·연락처 등 개인정보 패턴이 있으면 제출을 막는다(서버도 같은 규칙으로 다시 검사).
  reasonField?: { name: string; label: string; placeholder?: string; required?: boolean; checkPii?: boolean };
  // 아래는 모두 선택 prop이다. 주지 않으면 렌더 결과·동작이 기존과 똑같다(test/components/confirm-dialog.test.ts가 고정).
  // 자가진단 기록 지우기(bara-edu-lms.diagnosis-sensitive-consent.md 디자인 스펙 D4·D6)에서 처음 썼다.
  // extraCheckbox: 설명 아래 체크박스 1개(예: "강사과정 상담 문의도 함께 지우기"). 체크하면 FormData에 name=on이 실린다.
  extraCheckbox?: { name: string; label: string; help?: string; defaultChecked?: boolean };
  // 'cancel': 열릴 때 취소 버튼에 포커스(파괴적 동작의 우발 실행 방지). 기본은 브라우저 기본(첫 포커스 가능 요소).
  initialFocus?: 'cancel';
  // true면 <dialog>에 aria-labelledby(제목)·aria-describedby(설명)를 건다.
  describe?: boolean;
  // 트리거 버튼의 스크린리더 이름(보이는 글자와 달리 행을 구분해야 할 때, 예: "2026. 12. 3. 진단 기록 지우기").
  triggerAriaLabel?: string;
  // 제출 중 확인 버튼 글자(예: "지우는 중이에요"). 주면 제출 중에는 버튼도 비활성화한다.
  pendingLabel?: string;
};

// 승인/반려/승인취소/삭제 등 여러 관리자 화면에서 재사용하는 확인 다이얼로그.
// native <dialog>만 쓰고(별도 모달 라이브러리 없음), 그 안의 <form action={action}>이
// 실제 서버 액션을 호출한다. id 등 대상 식별자는 action.bind(null, id) 형태로 미리
// 바인딩해서 넘긴다(components/enrollment 등 기존 코드와 동일한 방식).
export default function ConfirmDialog({
  triggerLabel,
  triggerClassName,
  title,
  description,
  confirmLabel = '확인',
  tone = 'neutral',
  size = 'md',
  cancelLabel = '취소',
  disabled,
  disabledReason,
  action,
  reasonField,
  extraCheckbox,
  initialFocus,
  describe,
  triggerAriaLabel,
  pendingLabel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const titleId = describe ? `${baseId}-title` : undefined;
  const descId = describe && description ? `${baseId}-desc` : undefined;
  const extraHelpId = extraCheckbox?.help ? `${baseId}-extra-help` : undefined;

  if (disabled) {
    return (
      <span
        title={disabledReason}
        className="cursor-not-allowed rounded-pill border border-n-3 px-3 py-1.5 text-[12px] font-medium text-n-4"
      >
        {triggerLabel}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          dialogRef.current?.showModal();
          if (initialFocus === 'cancel') cancelRef.current?.focus();
        }}
        aria-label={triggerAriaLabel}
        className={
          triggerClassName ?? 'rounded-pill border border-n-3 px-3 py-1.5 text-[12px] font-medium text-n-7'
        }
      >
        {triggerLabel}
      </button>
      <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={descId} className="rounded-lg border border-n-3 p-0 shadow-lg backdrop:bg-n-9/40">
        <form action={action} className={`flex flex-col gap-4 p-5 ${size === 'lg' ? 'w-[min(320px,calc(100vw-32px))]' : 'w-[320px]'}`}>
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-[15px] font-semibold text-n-9">
              {title}
            </h2>
            {description && (
              <p id={descId} className={size === 'lg' && describe ? 'text-[15px] text-n-8' : 'text-[12.5px] text-n-6'}>
                {description}
              </p>
            )}
          </div>
          {reasonField && (
            <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
              {reasonField.label}
              <textarea
                name={reasonField.name}
                required={reasonField.required ?? true}
                placeholder={reasonField.placeholder}
                onChange={reasonField.checkPii ? (e) => e.currentTarget.setCustomValidity(leadNoteHasPii(e.currentTarget.value) ? LEAD_NOTE_PII_MESSAGE : '') : undefined}
                className="min-h-[72px] rounded-md border border-n-3 bg-n-1 p-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
              />
            </label>
          )}
          {extraCheckbox && (
            <div className="flex flex-col gap-1">
              <label className="flex min-h-12 cursor-pointer items-center gap-3 text-[15px] font-medium text-n-9">
                <input
                  type="checkbox"
                  name={extraCheckbox.name}
                  defaultChecked={extraCheckbox.defaultChecked}
                  aria-describedby={extraHelpId}
                  className="h-6 w-6 shrink-0 accent-indigo"
                />
                {extraCheckbox.label}
              </label>
              {extraCheckbox.help && (
                <p id={extraHelpId} className="text-[14px] text-n-7">
                  {extraCheckbox.help}
                </p>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={() => dialogRef.current?.close()}
              className={
                size === 'lg'
                  ? 'min-h-12 flex-1 rounded-pill border border-n-3 text-[15px] font-medium text-n-8'
                  : 'h-[38px] flex-1 rounded-pill border border-n-3 text-[13px] font-medium text-n-7'
              }
            >
              {cancelLabel}
            </button>
            <SubmitButton
              label={confirmLabel}
              pendingLabel={pendingLabel}
              className={`flex-1 rounded-pill font-semibold text-white ${size === 'lg' ? 'min-h-12 text-[15px]' : 'h-[38px] text-[13px]'} ${
                tone === 'danger' ? 'bg-danger' : size === 'lg' ? 'bg-indigo' : 'bg-pink'
              }`}
            />
          </div>
        </form>
      </dialog>
    </>
  );
}

// 확인 버튼. pendingLabel이 없으면 기존과 같은 <button type="submit">을 그린다(속성도 같다).
function SubmitButton({ label, pendingLabel, className }: { label: string; pendingLabel?: string; className: string }) {
  const { pending } = useFormStatus();
  if (!pendingLabel) {
    return (
      <button type="submit" className={className}>
        {label}
      </button>
    );
  }
  return (
    <button type="submit" disabled={pending} className={`${className} disabled:opacity-60`}>
      {pending ? pendingLabel : label}
    </button>
  );
}
