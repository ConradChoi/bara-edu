'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { restartLogin, verifyOtp, verifyRecoveryCode } from '@/app/actions/auth';
import MfaStatusScreen from '@/components/auth/MfaStatusScreen';
import OtpCodeField, { FieldError } from '@/components/auth/OtpCodeField';
import { FOCUS_RING, INPUT_LG } from '@/components/auth/PasswordField';
import { NOTICE, PAGE_TITLE_CLASS } from '@/components/auth/styles';
import { AlertIcon, ClockIcon, RefreshIcon } from '@/components/error/icons';
import { LINK_CLASS, PRIMARY_BTN, SECONDARY_BTN } from '@/components/error/styles';
import { MFA_COPY as C, fill } from '@/lib/mfa-copy';
import { isOtp, normalizeOtp } from '@/lib/mfa-format';
import type { MfaLoginState } from '@/lib/mfa-setup-types';

// M1 /sign-in/otp(6자리)·M2 /sign-in/recovery(복구 코드) — 기획서 3.2·3.3, 디자인 스펙 T-3·T-4, 카피 MFA-LOGIN-*·MFA-REC-*.
// 입력 한 칸 + 버튼 하나. 틀림·재사용은 칸을 비우고 칸으로 포커스(T-0 #6), 429·503은 폼 위 알림(입력 유지),
// 만료·5회·잠김·계정 변경은 폼을 상태 화면으로 바꾼다(T-3.3). JS 없이도 <form action>으로 동작한다.

const COUNT_SUFFIX = / \(\{n\}번 더 시도할 수 있어요\)$/;
// 남은 횟수가 없으면 괄호 문장을 뺀다(재확인처럼 서버가 횟수를 주지 않는 경우)
export function withCount(template: string, n: number | undefined): string {
  return n === undefined ? template.replace(COUNT_SUFFIX, '') : fill(template, { n });
}

const INPUT_RC = `${INPUT_LG.replace(' pr-[76px]', '')} font-mono text-xl uppercase tracking-wider`;

export function MfaLoginScreen({ state, focus }: { state: Extract<NonNullable<MfaLoginState>, { kind: 'screen' }>; focus: boolean }) {
  if (state.screen === 'locked') {
    return (
      <MfaStatusScreen
        focus={focus}
        icon={<AlertIcon className="size-7 text-danger" />}
        title={state.lockScope === 'daily' ? C['MFA-LOGIN-ERR-LOCKED-DAILY'] : fill(C['MFA-LOGIN-ERR-LOCKED'], { m: state.minutes })}
        actions={
          <>
            <Link href="/sign-in" className={SECONDARY_BTN}>
              {C['MFA-LOGIN-ERR-LOCKED-BTN1']}
            </Link>
            <Link href="/forgot-password" className={LINK_CLASS}>
              {C['MFA-LOGIN-ERR-LOCKED-BTN2']}
            </Link>
          </>
        }
      >
        <p>{C['MFA-LOGIN-ERR-LOCKED-2']}</p>
      </MfaStatusScreen>
    );
  }
  const [title, body, btn, icon] =
    state.screen === 'exhausted'
      ? [C['MFA-LOGIN-ERR-EXHAUSTED-TITLE'], C['MFA-LOGIN-ERR-EXHAUSTED'], C['MFA-LOGIN-ERR-LOCKED-BTN1'], <AlertIcon key="i" className="size-7 text-danger" />]
      : state.screen === 'demoted'
        ? [C['MFA-LOGIN-ERR-DEMOTED-TITLE'], C['MFA-LOGIN-ERR-DEMOTED'], C['MFA-LOGIN-ERR-EXPIRED-BTN'], <AlertIcon key="i" className="size-7 text-warning" />]
        : [C['MFA-LOGIN-ERR-EXPIRED-TITLE'], C['MFA-LOGIN-ERR-EXPIRED'], C['MFA-LOGIN-ERR-EXPIRED-BTN'], <ClockIcon key="i" className="size-7 text-n-7" />];
  return (
    <MfaStatusScreen
      focus={focus}
      icon={icon}
      title={title}
      actions={
        <Link href="/sign-in" className={PRIMARY_BTN}>
          {btn}
        </Link>
      }
    >
      <p>{body}</p>
    </MfaStatusScreen>
  );
}

export function NoticeAlert({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className={NOTICE}>
      <AlertIcon className="mt-0.5 size-6 shrink-0 text-danger" />
      <p>{children}</p>
    </div>
  );
}

export function RestartLoginButton({ label }: { label: string }) {
  return (
    <form action={restartLogin}>
      <button type="submit" className={`${LINK_CLASS} cursor-pointer`}>
        {label}
      </button>
    </form>
  );
}

export function SubmitButton({ pending, label, busy, className = PRIMARY_BTN }: { pending: boolean; label: string; busy: string; className?: string }) {
  return (
    <button type="submit" disabled={pending} aria-busy={pending || undefined} className={`${className} disabled:opacity-60`}>
      {pending && <RefreshIcon className="size-5 animate-spin motion-reduce:animate-none" />}
      {pending ? busy : label}
    </button>
  );
}

export default function MfaLoginForm({ mode, redirectTo, initial }: { mode: 'otp' | 'recovery'; redirectTo: string | null; initial?: MfaLoginState }) {
  const [state, formAction, pending] = useActionState<MfaLoginState, FormData>(mode === 'otp' ? verifyOtp : verifyRecoveryCode, initial);
  const [clientFormat, setClientFormat] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [first] = useState(state);

  useEffect(() => {
    if (state === first || state?.kind !== 'field') return;
    // 틀림·재사용: 칸을 비우고 칸으로. 형식 오류는 고쳐 쓰게 남긴다(T-3.2)
    if (state.error !== 'format' && inputRef.current) inputRef.current.value = '';
    inputRef.current?.focus();
  }, [state, first]);

  if (state?.kind === 'screen') return <MfaLoginScreen state={state} focus={state !== first} />;

  const otp = mode === 'otp';
  const fieldError = clientFormat
    ? otp
      ? C['MFA-LOGIN-ERR-FORMAT']
      : C['MFA-REC-ERR-FORMAT']
    : state?.kind === 'field'
      ? state.error === 'format'
        ? otp
          ? C['MFA-LOGIN-ERR-FORMAT']
          : C['MFA-REC-ERR-FORMAT']
        : state.error === 'used'
          ? C['MFA-LOGIN-ERR-USED']
          : withCount(otp ? C['MFA-LOGIN-ERR-WRONG'] : C['MFA-REC-ERR-WRONG'], state.attemptsLeft)
      : null;
  const notice =
    state?.kind === 'notice'
      ? state.notice === 'rate_limited'
        ? C['MFA-LOGIN-ERR-RATE']
        : state.notice === 'unavailable'
          ? C['MFA-LOGIN-ERR-UNAVAILABLE']
          : C['MFA-LOGIN-ERR-OTHER']
      : null;
  // 한 번이라도 틀리면 시계 도움말을 열어 둔다(T-3.1)
  const tipsOpen = state?.kind === 'field' && (state.error === 'wrong' || state.error === 'used');
  const descId = otp ? 'otp-desc' : 'rec-desc';

  return (
    <div>
      <h1 id={otp ? 'otp-title' : 'rec-title'} tabIndex={-1} className={PAGE_TITLE_CLASS}>
        {otp ? C['MFA-LOGIN-TITLE'] : C['MFA-REC-TITLE']}
      </h1>
      <p id={descId} className="mt-3 text-base leading-[1.7] text-n-7 break-keep">
        {otp ? `${C['MFA-LOGIN-DESC']} ${C['MFA-LOGIN-TIME']}` : C['MFA-REC-DESC']}
      </p>

      <form
        action={formAction}
        noValidate
        className="mt-8 flex flex-col gap-5"
        onSubmit={(e) => {
          const raw = inputRef.current?.value ?? '';
          const bad = otp ? !isOtp(normalizeOtp(raw)) : !raw.trim();
          setClientFormat(bad);
          if (bad) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        {notice && <NoticeAlert>{notice}</NoticeAlert>}
        {redirectTo && <input type="hidden" name="redirect" value={redirectTo} />}
        {otp ? (
          <OtpCodeField
            label={C['MFA-LOGIN-LABEL']}
            hint={C['MFA-LOGIN-HELP']}
            error={fieldError}
            describedBy={descId}
            inputRef={inputRef}
            onEdit={() => clientFormat && setClientFormat(false)}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor="recovery-code" className="text-base font-semibold text-n-9">
              {C['MFA-REC-LABEL']}
            </label>
            <p id="recovery-hint" className="text-base leading-[1.6] text-n-7 break-keep">
              {C['MFA-REC-HELP']}
            </p>
            <input
              ref={inputRef}
              id="recovery-code"
              name="recoveryCode"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={20}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={`${descId} recovery-hint${fieldError ? ' recovery-code-error' : ''}`}
              className={`scroll-mt-20 ${INPUT_RC}`}
              onChange={() => clientFormat && setClientFormat(false)}
            />
            {fieldError && (
              <FieldError id="recovery-code-error" size="lg">
                {fieldError}
              </FieldError>
            )}
          </div>
        )}
        <SubmitButton
          pending={pending}
          label={otp ? C['MFA-LOGIN-BTN'] : C['MFA-REC-BTN']}
          busy={otp ? C['MFA-LOGIN-BTN-BUSY'] : C['MFA-REC-BTN-BUSY']}
        />
      </form>

      <div className="mt-2 flex flex-col gap-1">
        {otp ? (
          <Link href={redirectTo ? `/sign-in/recovery?redirect=${encodeURIComponent(redirectTo)}` : '/sign-in/recovery'} className={LINK_CLASS}>
            {C['MFA-LOGIN-LINK-RECOVERY']}
          </Link>
        ) : (
          <Link href={redirectTo ? `/sign-in/otp?redirect=${encodeURIComponent(redirectTo)}` : '/sign-in/otp'} className={LINK_CLASS}>
            {C['MFA-REC-LINK-OTP']}
          </Link>
        )}
        <RestartLoginButton label={otp ? C['MFA-LOGIN-LINK-RESTART'] : C['MFA-REC-LINK-RESTART']} />
      </div>

      {otp ? (
        <details open={tipsOpen || undefined} className="mt-4">
          <summary className={`flex min-h-12 cursor-pointer items-center text-base text-indigo underline underline-offset-4 ${FOCUS_RING}`}>
            {C['MFA-LOGIN-TIPS-TITLE']}
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-base leading-[1.7] text-n-7 break-keep">
            <li>{C['MFA-LOGIN-TIPS-1']}</li>
            <li>{C['MFA-LOGIN-TIPS-2']}</li>
            <li>{C['MFA-LOGIN-TIPS-3']}</li>
          </ul>
        </details>
      ) : (
        <div className="mt-6 border-t border-n-3 pt-6">
          <p className="text-base font-semibold text-n-9">{C['MFA-REC-NONE-TITLE']}</p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-base leading-[1.7] text-n-7 break-keep">
            <li>{C['MFA-REC-NONE-1']}</li>
            <li>{C['MFA-REC-NONE-2']}</li>
            <li>{C['MFA-REC-NONE-3']}</li>
          </ul>
        </div>
      )}
    </div>
  );
}
