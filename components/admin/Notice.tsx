import type { ReactNode, Ref } from 'react';

type Tone = 'info' | 'warning' | 'danger' | 'success';

// 글자는 n-8/n-9, 톤 색은 왼쪽 선과 아이콘에만 쓴다(danger·success 색 글자는 14px에서 대비 4.5:1 미만).
const BORDER: Record<Tone, string> = {
  info: 'border-l-info',
  warning: 'border-l-warning',
  danger: 'border-l-danger',
  success: 'border-l-success',
};
const ICON: Record<Tone, string> = { info: 'text-info', warning: 'text-warning', danger: 'text-danger', success: 'text-success' };

function Icon({ tone }: { tone: Tone }) {
  return (
    <svg className={`mt-0.5 size-4 shrink-0 ${ICON[tone]}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {tone === 'success' ? (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="m8 12 3 3 5-6" />
        </>
      ) : tone === 'info' ? (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </>
      ) : (
        <>
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </>
      )}
    </svg>
  );
}

export default function Notice({
  tone,
  role = 'note',
  title,
  tabIndex,
  id,
  ref,
  children,
}: {
  tone: Tone;
  role?: 'note' | 'status' | 'alert';
  title?: string;
  tabIndex?: number;
  id?: string;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      ref={ref}
      role={role}
      tabIndex={tabIndex}
      className={`flex gap-3 rounded-md border border-n-3 border-l-4 ${BORDER[tone]} bg-n-1 px-4 py-3 text-[14px] leading-[1.6] text-n-8 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo`}
    >
      <Icon tone={tone} />
      <div className="flex min-w-0 flex-col gap-1 break-words">
        {title && <p className="font-semibold text-n-9">{title}</p>}
        {children}
      </div>
    </div>
  );
}
