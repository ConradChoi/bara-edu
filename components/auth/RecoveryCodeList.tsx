'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FieldError } from '@/components/auth/OtpCodeField';
import SpokenCode from '@/components/auth/SpokenCode';
import { hasClipboard, hasPrint, useBrowserSupport } from '@/components/auth/useBrowserSupport';
import { AlertIcon } from '@/components/error/icons';
import { MFA_COPY as C, fill } from '@/lib/mfa-copy';

// 복구 코드 10개(한 번만 보여 줌) — 디자인 스펙 T-5.4, 카피 MFA-RC-*·MFA-PRINT-*.
// 등록(입구 A·B·C)과 [복구 코드 새로 받기]가 같이 쓴다. 코드는 서버 액션 상태로만 받고 저장하지 않는다
// (localStorage·URL·파일 없음, [파일로 받기] 없음, 1.3 D9). 인쇄물에는 이름은 넣고 이메일은 넣지 않는다(1.3 D6).
// [관리자 화면으로]는 "보관했어요" 체크 전에는 aria-disabled(포커스 유지 + 이유 문장 연결). JS가 없으면 required가 같은 역할.

export type RecoveryCodeListProps = {
  codes: string[];
  issuedOn: string;
  name: string | null;
  size: 'lg' | 'admin';
  // 체크 뒤 이동하는 폼의 hidden 필드(intent=ack 등)
  hidden: Record<string, string>;
  formAction: (fd: FormData) => void;
  pending: boolean;
  primaryClass: string;
  secondaryClass: string;
  // 목록 위(제목 아래) 덧붙일 안내(다시 등록 완료 등)
  lead?: ReactNode;
};

export default function RecoveryCodeList({ codes, issuedOn, name, size, hidden, formAction, pending, primaryClass, secondaryClass, lead }: RecoveryCodeListProps) {
  const [kept, setKept] = useState(false);
  const [triedEarly, setTriedEarly] = useState(false);
  const [copied, setCopied] = useState(false);
  const [printFailed, setPrintFailed] = useState(false);
  // 클립보드·인쇄는 JS가 있고 브라우저가 지원할 때만 보인다(서버 렌더는 둘 다 숨김 → 하이드레이션 뒤 판단, T-10)
  const [copyBroken, setCopyBroken] = useState(false);
  const canCopy = useBrowserSupport(hasClipboard) === true && !copyBroken;
  const canPrint = useBrowserSupport(hasPrint);
  const checkRef = useRef<HTMLInputElement>(null);
  const body = size === 'lg' ? 'text-base' : 'text-[14px]';

  // 체크 전에 창을 닫으려 하면 브라우저 기본 확인(보조 수단, T-5.4)
  useEffect(() => {
    if (kept) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [kept]);

  return (
    <div className="flex flex-col gap-5">
      {lead}
      <p className={`${body} leading-[1.7] text-n-7 break-keep`}>{C['MFA-RC-WHAT']}</p>
      <div role="note" className={`flex gap-3 rounded-md border border-l-4 border-n-3 border-l-warning bg-n-1 px-4 py-3 ${body} leading-[1.6] text-n-9 break-keep`}>
        <AlertIcon className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="flex flex-col gap-1">
          <p>{C['MFA-RC-ONCE-1']}</p>
          <p className="font-semibold">{C['MFA-RC-ONCE-2']}</p>
        </div>
      </div>

      <section aria-label={C['MFA-RC-LIST-LABEL']}>
        <ol id="rc-list" className="grid grid-cols-1 gap-y-2 rounded-md border-2 border-n-5 bg-n-1 p-4 sm:grid-cols-2 sm:gap-x-6">
          {codes.map((code, i) => (
            <li key={code} className="flex items-baseline gap-3">
              <span aria-hidden="true" className="w-6 text-base text-n-6">
                {i + 1}.
              </span>
              <SpokenCode code={code} className="font-mono text-xl tracking-wide text-n-9" />
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {canPrint && (
          <button
            type="button"
            className={secondaryClass}
            onClick={() => {
              try {
                window.print();
              } catch {
                setPrintFailed(true);
              }
            }}
          >
            {C['MFA-RC-PRINT']}
          </button>
        )}
        {canCopy && (
          <button
            type="button"
            className={secondaryClass}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(codes.join('\n'));
                setCopied(true);
              } catch {
                setCopyBroken(true);
              }
            }}
          >
            {C['MFA-RC-COPY']}
          </button>
        )}
      </div>
      <p id="rc-copy-status" aria-live="polite" className={`${body} text-n-8 empty:hidden`}>
        {copied ? C['MFA-RC-COPIED'] : ''}
      </p>
      {(canPrint === false || printFailed) && <p className={`${body} leading-[1.6] text-n-8 break-keep`}>{printFailed ? C['MFA-RC-ERR-PRINT'] : C['MFA-RC-PRINT-ALT']}</p>}

      <div className={`${body} leading-[1.7] text-n-8 break-keep`}>
        <p className="font-semibold text-n-9">{C['MFA-RC-KEEP-TITLE']}</p>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          <li>{C['MFA-RC-KEEP-1']}</li>
          <li>{C['MFA-RC-KEEP-2']}</li>
          <li>{C['MFA-RC-KEEP-3']}</li>
        </ul>
      </div>

      <form
        action={formAction}
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          if (!kept) {
            e.preventDefault();
            setTriedEarly(true);
            checkRef.current?.focus();
          }
        }}
      >
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-md border-2 border-n-5 p-4 has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-indigo">
          <input
            ref={checkRef}
            id="rc-kept"
            type="checkbox"
            name="kept"
            required
            checked={kept}
            onChange={(e) => {
              setKept(e.target.checked);
              if (e.target.checked) setTriedEarly(false);
            }}
            aria-describedby={triedEarly ? 'rc-kept-error' : undefined}
            className="mt-0.5 size-6 shrink-0 accent-indigo"
          />
          <span className={`${body} text-n-9 break-keep`}>{C['MFA-RC-CHECK']}</span>
        </label>
        {triedEarly && (
          <FieldError id="rc-kept-error" size={size}>
            {C['MFA-RC-NEXT-DISABLED']}
          </FieldError>
        )}
        {!kept && !triedEarly && (
          <p id="rc-kept-hint" className="text-sm text-n-6">
            {C['MFA-RC-NEXT-DISABLED']}
          </p>
        )}
        <button
          type="submit"
          aria-disabled={!kept || pending || undefined}
          aria-describedby={!kept && !triedEarly ? 'rc-kept-hint' : undefined}
          className={`${primaryClass} ${!kept ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          {C['MFA-RC-NEXT']}
        </button>
      </form>

      <PrintSheet codes={codes} issuedOn={issuedOn} name={name} />
    </div>
  );
}

// 인쇄 전용 안내지(카피 8장). 화면에서는 숨기고, 인쇄할 때는 이 블록만 보인다(globals.css의 .mfa-print-sheet 규칙).
function PrintSheet({ codes, issuedOn, name }: { codes: string[]; issuedOn: string; name: string | null }) {
  return (
    <div className="mfa-print-sheet hidden text-[14pt] leading-[1.7] text-black print:block" aria-hidden="true">
      <p className="text-[18pt] font-bold">{C['MFA-PRINT-TITLE']}</p>
      <p>{fill(C['MFA-PRINT-DATE'], { date: issuedOn })}</p>
      {name && <p>{fill(C['MFA-PRINT-WHO'], { 이름: name })}</p>}
      <p className="font-bold">{C['MFA-PRINT-WARN']}</p>
      <p className="mt-2">{C['MFA-PRINT-WHAT']}</p>
      <p className="mt-3 font-bold">{C['MFA-PRINT-LIST-HEAD']}</p>
      <ol className="mt-1">
        {codes.map((code, i) => (
          <li key={code} className="flex justify-between gap-6 border-b border-black py-1">
            <span className="font-mono text-[18pt]">
              {i + 1}. {code}
            </span>
            <span>{C['MFA-PRINT-ROW-USED']}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 font-bold">{C['MFA-PRINT-HOW-TITLE']}</p>
      <ol className="list-decimal pl-6">
        {C['MFA-PRINT-HOW'].map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      <p className="mt-3 font-bold">{C['MFA-PRINT-KEEP-TITLE']}</p>
      <ul className="list-disc pl-6">
        {C['MFA-PRINT-KEEP'].map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <p className="mt-3 font-bold">{C['MFA-PRINT-LOW-TITLE']}</p>
      <p>{C['MFA-PRINT-LOW-1']}</p>
      <p className="mt-3 font-bold">{C['MFA-PRINT-LOST-TITLE']}</p>
      <p>{C['MFA-PRINT-LOST-1']}</p>
      <p className="mt-3 text-[12pt]">{C['MFA-PRINT-FOOT']}</p>
    </div>
  );
}
