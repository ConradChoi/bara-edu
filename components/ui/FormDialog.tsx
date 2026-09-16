'use client';

import { useRef, type ReactNode } from 'react';

type FormDialogProps = {
  triggerLabel: string;
  triggerClassName?: string;
  title: string;
  submitLabel?: string;
  widthClassName?: string;
  // 회원탈퇴처럼 파괴적인 작업의 확정 버튼을 danger 색으로 구분하기 위해 추가
  // (ConfirmDialog의 tone prop과 동일한 목적, 2026-09-16).
  tone?: 'neutral' | 'danger';
  action: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
};

// ConfirmDialog와 동일한 patttern(native <dialog> + 그 안의 <form action={action}>)을
// 재사용하되, 확인 문구 하나가 아니라 임의의 입력 필드를 담을 수 있게 일반화한 버전.
// "추가" 버튼을 누르면 바로 목록에 반영되던 문제은행 문항 등록 흐름을, 레이어 팝업에서
// 다 입력한 뒤 확정하는 방식으로 바꿔달라는 관리자 요청으로 신규 추가(2026-09-12).
export default function FormDialog({
  triggerLabel,
  triggerClassName,
  title,
  submitLabel = '등록',
  widthClassName = 'w-[360px]',
  tone = 'neutral',
  action,
  children,
}: FormDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className={triggerClassName ?? 'rounded-pill bg-pink px-4 py-1.5 text-[12.5px] font-semibold text-white'}
      >
        {triggerLabel}
      </button>
      <dialog ref={dialogRef} className="rounded-lg border border-n-3 p-0 shadow-lg backdrop:bg-n-9/40">
        {/* multipart/form-data는 파일 입력이 없는 폼에도 문제 없이 동작해, 이 컴포넌트를
            공용으로 쓰면서도 파일 업로드가 필요한 호출부(사진 첨부 등)를 특별 취급할
            필요가 없다(courses/[slug]/apply 폼과 동일 방식, 2026-09-16). */}
        <form action={action} encType="multipart/form-data" className={`flex ${widthClassName} flex-col gap-4 p-5`}>
          <h2 className="text-[15px] font-semibold text-n-9">{title}</h2>
          <div className="flex flex-col gap-3">{children}</div>
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
              {submitLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
