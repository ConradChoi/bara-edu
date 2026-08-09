'use client';

import { useRef } from 'react';

type ConfirmDialogProps = {
  triggerLabel: string;
  triggerClassName?: string;
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: 'neutral' | 'danger';
  disabled?: boolean;
  disabledReason?: string;
  action: (formData: FormData) => void | Promise<void>;
  reasonField?: { name: string; label: string; placeholder?: string };
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
  disabled,
  disabledReason,
  action,
  reasonField,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

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
        onClick={() => dialogRef.current?.showModal()}
        className={
          triggerClassName ?? 'rounded-pill border border-n-3 px-3 py-1.5 text-[12px] font-medium text-n-7'
        }
      >
        {triggerLabel}
      </button>
      <dialog ref={dialogRef} className="rounded-lg border border-n-3 p-0 shadow-lg backdrop:bg-n-9/40">
        <form action={action} className="flex w-[320px] flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-[15px] font-semibold text-n-9">{title}</h2>
            {description && <p className="text-[12.5px] text-n-6">{description}</p>}
          </div>
          {reasonField && (
            <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
              {reasonField.label}
              <textarea
                name={reasonField.name}
                required
                placeholder={reasonField.placeholder}
                className="min-h-[72px] rounded-md border border-n-3 bg-n-1 p-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
              />
            </label>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="h-[38px] flex-1 rounded-pill border border-n-3 text-[13px] font-medium text-n-7"
            >
              취소
            </button>
            <button
              type="submit"
              className={`h-[38px] flex-1 rounded-pill text-[13px] font-semibold text-white ${
                tone === 'danger' ? 'bg-danger' : 'bg-pink'
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
