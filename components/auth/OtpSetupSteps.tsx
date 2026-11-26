'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { otpSetupStep } from '@/app/actions/auth';
import MfaStatusScreen from '@/components/auth/MfaStatusScreen';
import { MfaLoginScreen, SubmitButton, withCount } from '@/components/auth/MfaLoginForm';
import OtpCodeField, { FieldError, OTP_HINT_CLASS, OTP_LABEL_CLASS } from '@/components/auth/OtpCodeField';
import { FOCUS_RING, INPUT_LG } from '@/components/auth/PasswordField';
import RecoveryCodeList from '@/components/auth/RecoveryCodeList';
import { hasClipboard, useBrowserSupport } from '@/components/auth/useBrowserSupport';
import SpokenCode from '@/components/auth/SpokenCode';
import { NOTICE, NOTICE_INFO, PAGE_TITLE_CLASS } from '@/components/auth/styles';
import { AlertIcon, CheckIcon, ClockIcon } from '@/components/error/icons';
import { ADMIN_PRIMARY_BTN, ADMIN_SECONDARY_BTN, ADMIN_TEXT_LINK, LINK_CLASS, PRIMARY_BTN, SECONDARY_BTN } from '@/components/error/styles';
import { MFA_COPY as C, MFA_COPY_PENDING_REVIEW as P, fill, stepSr } from '@/lib/mfa-copy';
import { isOtp, isTicket, normalizeOtp, normalizeTicket } from '@/lib/mfa-format';
import type { SetupEntry, SetupNotice, SetupView } from '@/lib/mfa-setup-types';

// 2단계 인증 등록 단계(디자인 스펙 T-5, 기획서 3.4). 로그인 중(입구 B, /sign-in/otp-setup, size=lg)과
// 내 보안 설정(입구 A·C·복구 코드 새로 받기, /admin/security, size=admin)이 같은 단계 화면을 쓴다.
// 단계 이동은 모두 서버 액션(intent)이고, 이 컴포넌트는 같은 자리에 남아 있다 — 등록 확정 응답이 세션 쿠키를 바꿔
// 라우트가 다시 그려져도 복구 코드(액션 상태)는 그대로 보인다. 새로고침하면 서버 상태에 맞는 단계로 돌아온다.

// 공식 안내 페이지(각 페이지에서 iOS·Android 스토어로 간다). 이 화면에서 외부로 나가므로 새 창(대기표 15분 유지, T-5.1).
const APP_LINKS = [
  { href: 'https://support.google.com/accounts/answer/1066447?hl=ko', label: C['MFA-SETUP-APP-LINK-G'] },
  { href: 'https://www.microsoft.com/ko-kr/security/mobile-authenticator-app', label: C['MFA-SETUP-APP-LINK-M'] },
] as const;

type Size = 'lg' | 'admin';

const STYLE = {
  lg: {
    title: PAGE_TITLE_CLASS,
    body: 'text-base leading-[1.7] text-n-7 break-keep',
    strong: 'text-base font-semibold text-n-9',
    primary: PRIMARY_BTN,
    secondary: SECONDARY_BTN,
    link: LINK_CLASS,
    info: NOTICE_INFO,
  },
  admin: {
    title: 'scroll-mt-20 text-[17px] font-semibold text-n-9 break-keep outline-none',
    body: 'text-[14px] leading-[1.7] text-n-7 break-keep',
    strong: 'text-[14px] font-semibold text-n-9',
    primary: ADMIN_PRIMARY_BTN,
    secondary: ADMIN_SECONDARY_BTN,
    link: ADMIN_TEXT_LINK,
    info: 'rounded-md bg-n-1 px-4 py-3 text-[14px] leading-[1.6] text-n-8 break-keep',
  },
} as const;

// 진행 표시(T-5.0, 1.3 D13: 입구에 맞게 계산). 등록 코드가 있는 입구 B만 4단계.
function stepsOf(entry: SetupEntry): readonly string[] {
  return entry === 'B' ? C['MFA-SETUP-STEPS-A'] : C['MFA-SETUP-STEPS-B'];
}
function stepIndex(view: SetupView, entry: SetupEntry): number | null {
  if (view.step === 'prep') return 1;
  if (view.step === 'ticket') return 2;
  if (view.step === 'qr' || view.step === 'qr_expired') return entry === 'B' ? 3 : 2;
  if (view.step === 'codes' && view.reason !== 'regen') return entry === 'B' ? 4 : 3;
  return null;
}

export function noticeText(n: SetupNotice): string {
  switch (n.kind) {
    case 'rate_limited':
      return C['MFA-LOGIN-ERR-RATE'];
    case 'unavailable':
      return C['MFA-CONFIRM-ERR-UNAVAILABLE'];
    case 'locked':
      return n.lockScope === 'daily' ? C['MFA-LOGIN-ERR-LOCKED-DAILY'] : fill(C['MFA-CONFIRM-ERR-LOCKED'], { m: n.minutes });
    case 'already':
      return C['MFA-SEC-ALREADY'];
    case 'session_expired':
      return C['MFA-RESET-ERR-401'];
    case 'not_admin':
      return C['MFA-LOGIN-ERR-DEMOTED'];
    case 'norc':
      return C['MFA-CHANGE-NORC'];
    default:
      return C['MFA-LOGIN-ERR-OTHER'];
  }
}

function NoticeBox({ notice, size, extra, focusRef }: { notice: SetupNotice; size: Size; extra?: ReactNode; focusRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={focusRef} tabIndex={focusRef ? -1 : undefined} role="alert" className={`${NOTICE} ${size === 'admin' ? 'text-[14px]' : ''} outline-none`}>
      <AlertIcon className={`mt-0.5 shrink-0 text-danger ${size === 'lg' ? 'size-6' : 'size-5'}`} />
      <div className="flex flex-col gap-1">
        <p>{noticeText(notice)}</p>
        {extra}
      </div>
    </div>
  );
}

function Hidden({ fields }: { fields: Record<string, string | undefined> }) {
  return (
    <>
      {Object.entries(fields).map(([k, v]) => (v === undefined ? null : <input key={k} type="hidden" name={k} value={v} />))}
    </>
  );
}

export type SetupBodyProps = {
  view: Exclude<SetupView, { step: 'status' }>;
  formAction: (fd: FormData) => void;
  pending: boolean;
  size: Size;
  // 모든 폼에 싣는 값(redirect, reason 등. 비밀 값 없음)
  carry: Record<string, string | undefined>;
  // 로그인 중 다시 등록(?reason=reset)
  reset?: boolean;
  // 입구 C 재확인에서 복구 코드로 바꾸는 링크를 보일지(남은 복구 코드가 있을 때만, 3.4)
  recoveryCodesLeft?: number;
  // 액션 결과로 그려졌을 때만 포커스 이동(첫 진입 autofocus 금지)
  focus: boolean;
  // 첫 단계의 [이전](관리자 화면의 상태 카드로). 로그인 중에는 없다
  backToStatus?: boolean;
};

export function SetupBody({ view, formAction, pending, size, carry, reset = false, recoveryCodesLeft, focus, backToStatus = false }: SetupBodyProps) {
  const s = STYLE[size];
  const H = size === 'lg' ? 'h1' : 'h2';
  const titleRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 브라우저 형식 검사 오류. 어느 화면 상태에서 난 것인지 함께 둬서, 서버가 새 상태를 주면 저절로 사라진다
  const [localError, setLocalError] = useState<{ on: SetupView; msg: string } | null>(null);
  const clientError = localError && localError.on === view ? localError.msg : null;
  const setClientError = (msg: string | null) => setLocalError(msg ? { on: view, msg } : null);
  const [copied, setCopied] = useState(false);
  const [copyBroken, setCopyBroken] = useState(false);
  const canCopy = useBrowserSupport(hasClipboard) === true && !copyBroken;
  const manualRef = useRef<HTMLDetailsElement>(null);

  // 단계가 바뀌면 그 단계 제목으로, 칸 오류면 칸으로(틀림·재사용은 비운다), QR 만료면 알림으로(T-8)
  useEffect(() => {
    if (!focus) return;
    if ('error' in view && view.error) {
      if (view.error !== 'format' && inputRef.current) inputRef.current.value = '';
      inputRef.current?.focus();
    } else if (view.step === 'qr_expired') {
      alertRef.current?.focus();
    } else {
      titleRef.current?.focus();
    }
  }, [view, focus]);

  if (view.step === 'end') {
    if (view.screen === 'demoted') return <MfaLoginScreen state={{ kind: 'screen', screen: 'demoted' }} focus={focus} />;
    if (view.screen === 'ticket_dead') {
      const [title, ...rest] = C['MFA-TICKET-ERR-DEAD'].split('. ');
      return (
        <MfaStatusScreen
          focus={focus}
          icon={<AlertIcon className="size-7 text-danger" />}
          title={`${title}.`}
          actions={
            <Link href="/sign-in" className={SECONDARY_BTN}>
              {C['MFA-LOGIN-ERR-LOCKED-BTN1']}
            </Link>
          }
        >
          <p>{rest.join('. ')}</p>
          <p>{C['MFA-TICKET-NONE-BODY']}</p>
        </MfaStatusScreen>
      );
    }
    if (view.screen === 'reload') {
      const [title, ...rest] = C['MFA-RC-RELOAD'].split('. ');
      return (
        <MfaStatusScreen
          focus={focus}
          icon={<CheckIcon className="size-7 text-success" />}
          title={`${title}.`}
          actions={
            <Link href="/admin" className={PRIMARY_BTN}>
              {C['MFA-RC-NEXT']}
            </Link>
          }
        >
          <p>{rest.join('. ')}</p>
        </MfaStatusScreen>
      );
    }
    // 등록 대기표(15분) 만료: MFA-CONFIRM-ERR-401을 제목·본문 두 문장으로 나눠 쓴다
    const [title, ...rest] = C['MFA-CONFIRM-ERR-401'].split('. ');
    return (
      <MfaStatusScreen
        focus={focus}
        icon={<ClockIcon className="size-7 text-n-7" />}
        title={`${title}.`}
        actions={
          <Link href="/sign-in" className={PRIMARY_BTN}>
            {C['MFA-LOGIN-ERR-EXPIRED-BTN']}
          </Link>
        }
      >
        <p>{rest.join('. ')}</p>
      </MfaStatusScreen>
    );
  }

  // 로그인 중 화면은 늘 입구 B. 관리자 화면의 복구 코드 단계는 첫 등록이면 A, 바꾸기면 C
  const entry: SetupEntry = 'entry' in view ? view.entry : size === 'lg' ? 'B' : view.step === 'codes' && view.reason === 'enroll' ? 'A' : 'C';
  const idx = stepIndex(view, entry);
  const names = stepsOf(entry);
  const progress =
    idx !== null ? (
      // 눈으로 보는 진행 표시. 스크린리더는 제목 안의 sr-only 문장(MFA-SETUP-STEP-SR)으로 듣는다(T-8)
      <div aria-hidden="true">
        <p className="text-sm font-semibold text-n-7">{`${idx}/${names.length}단계: ${names[idx - 1]}`}</p>
        <div className="mt-2 flex gap-1.5">
          {names.map((n, i) => (
            <span key={n} className={`h-1.5 flex-1 rounded-pill ${i < idx ? 'bg-indigo' : 'bg-n-3'}`} />
          ))}
        </div>
      </div>
    ) : null;
  const srStep = idx !== null ? <span className="sr-only">{`${stepSr(names.length, idx, names[idx - 1])} `}</span> : null;

  const heading = (text: string) => (
    <H ref={titleRef} tabIndex={-1} className={s.title}>
      {srStep}
      {text}
    </H>
  );

  // [이전]: 앱 준비 단계의 이전은 상태 카드(관리자 화면만), 그 밖은 앱 준비 단계
  const backButton = (to: 'status' | 'prep', extra: Record<string, string | undefined> = {}) => (
    <form action={formAction}>
      <Hidden fields={{ ...carry, intent: 'back', to, ...extra }} />
      <button type="submit" className={`${s.link} cursor-pointer`}>
        {C['MFA-SETUP-BACK']}
      </button>
    </form>
  );

  if (view.step === 'prep') {
    const changing = view.entry === 'C';
    return (
      <div className="flex flex-col gap-5">
        {progress}
        {view.notice && <NoticeBox notice={view.notice} size={size} />}
        {reset ? (
          <>
            {heading(C['MFA-REENROLL-TITLE'])}
            <div className={`flex flex-col gap-2 ${s.body}`}>
              <p>{C['MFA-REENROLL-DESC']}</p>
              <p>{C['MFA-REENROLL-OLD']}</p>
              <p>{C['MFA-REENROLL-CODE']}</p>
              <p>{C['MFA-REENROLL-WHY']}</p>
            </div>
          </>
        ) : changing ? (
          heading(C['MFA-SETUP-APP-TITLE'])
        ) : (
          <>
            {heading(C['MFA-SETUP-TITLE'])}
            <div className={`flex flex-col gap-2 ${s.body}`}>
              <p>{C['MFA-SETUP-WHY-1']}</p>
              <p>{C['MFA-SETUP-WHY-2']}</p>
              <p>{C['MFA-SETUP-WHY-3']}</p>
            </div>
          </>
        )}
        <section className="flex flex-col gap-3">
          {!changing && <p className={s.strong}>{C['MFA-SETUP-APP-TITLE']}</p>}
          <p className={s.body}>{C['MFA-SETUP-APP-WHAT']}</p>
          <ul className={`flex list-disc flex-col gap-1 pl-5 ${s.body}`}>
            <li>{C['MFA-SETUP-APP-1']}</li>
            <li>{C['MFA-SETUP-APP-2']}</li>
            <li>{C['MFA-SETUP-APP-3']}</li>
          </ul>
          <ul className="flex flex-col gap-1">
            {APP_LINKS.map((a) => (
              <li key={a.href}>
                <a href={a.href} target="_blank" rel="noopener noreferrer" className={s.link}>
                  {a.label}
                  <span className="sr-only"> {P['APP-MFA-NEW-WINDOW']}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
        <div className={s.info}>
          <p className="font-semibold text-n-9">{C['MFA-SETUP-BACKUP-TITLE']}</p>
          <p className="mt-1">{C['MFA-SETUP-BACKUP-BODY']}</p>
          <p className="mt-1">{C['MFA-SETUP-BACKUP-HELP']}</p>
        </div>
        <form action={formAction}>
          <Hidden fields={{ ...carry, intent: 'next', entry: view.entry, checkedWith: view.checkedWith }} />
          <SubmitButton pending={pending} label={C['MFA-SETUP-NEXT']} busy={C['MFA-CONFIRM-BTN-BUSY']} className={s.primary} />
        </form>
        <details className={s.body}>
          <summary className={`flex min-h-12 cursor-pointer items-center text-indigo underline underline-offset-4 ${FOCUS_RING}`}>{C['MFA-SETUP-NOPHONE']}</summary>
          <p className="mt-1">{C['MFA-SETUP-NOPHONE-BODY']}</p>
        </details>
        {backToStatus && backButton('status')}
      </div>
    );
  }

  if (view.step === 'ticket') {
    const err = clientError ?? (view.error === 'format' ? C['MFA-TICKET-ERR-FORMAT'] : view.error === 'wrong' ? withCount(C['MFA-TICKET-ERR-WRONG'], view.attemptsLeft) : null);
    return (
      <div className="flex flex-col gap-5">
        {progress}
        {heading(C['MFA-TICKET-TITLE'])}
        <p id="ticket-desc" className={s.body}>
          {C['MFA-TICKET-DESC']}
        </p>
        <form
          action={formAction}
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            if (!isTicket(normalizeTicket(inputRef.current?.value ?? ''))) {
              e.preventDefault();
              setClientError(C['MFA-TICKET-ERR-FORMAT']);
              inputRef.current?.focus();
            }
          }}
        >
          {view.notice && <NoticeBox notice={view.notice} size={size} />}
          <Hidden fields={{ ...carry, intent: 'ticket' }} />
          <div className="flex flex-col gap-2">
            <label htmlFor="ticket-code" className={OTP_LABEL_CLASS[size]}>
              {C['MFA-TICKET-LABEL']}
            </label>
            <input
              ref={inputRef}
              id="ticket-code"
              name="ticket"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9 ]*"
              maxLength={9}
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={err ? true : undefined}
              aria-describedby={`ticket-desc${err ? ' ticket-code-error' : ''}`}
              className={`scroll-mt-20 ${INPUT_LG.replace(' pr-[76px]', '')} font-mono text-2xl tabular-nums tracking-[0.3em]`}
              onChange={(e) => {
                const cleaned = e.target.value.replace(/[^0-9 ]/g, '');
                if (cleaned !== e.target.value) e.target.value = cleaned;
                if (clientError) setClientError(null);
              }}
            />
            {err && (
              <FieldError id="ticket-code-error" size={size}>
                {err}
              </FieldError>
            )}
          </div>
          <SubmitButton pending={pending} label={C['MFA-TICKET-BTN']} busy={C['MFA-TICKET-BTN-BUSY']} className={s.primary} />
        </form>
        {backButton('prep', { entry: 'B' })}
        <div className={`border-t border-n-3 pt-5 ${s.body}`}>
          <p className={s.strong}>{C['MFA-TICKET-NONE']}</p>
          <p className="mt-1">{C['MFA-TICKET-NONE-BODY']}</p>
        </div>
      </div>
    );
  }

  if (view.step === 'recheck') {
    const rc = view.mode === 'rc';
    const err =
      clientError ??
      (view.error === 'format'
        ? rc
          ? C['MFA-REC-ERR-FORMAT']
          : C['MFA-LOGIN-ERR-FORMAT']
        : view.error === 'used'
          ? C['MFA-LOGIN-ERR-USED']
          : view.error === 'wrong'
            ? rc
              ? C['MFA-CHANGE-RC-ERR']
              : C['MFA-SEC-RECHECK-ERR-WRONG']
            : null);
    const canUseRc = view.purpose === 'change' && (recoveryCodesLeft ?? 0) > 0;
    return (
      <div className="flex flex-col gap-5">
        {heading(view.purpose === 'regen' ? C['MFA-SEC-BTN-RC'] : C['MFA-SEC-BTN-CHANGE'])}
        <p id="recheck-desc" className={s.body}>
          {view.purpose === 'regen' ? C['MFA-SEC-BTN-RC-HELP'] : C['MFA-SEC-BTN-CHANGE-HELP']}
        </p>
        <form
          action={formAction}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            const raw = inputRef.current?.value ?? '';
            const bad = rc ? !raw.trim() : !isOtp(normalizeOtp(raw));
            if (bad) {
              e.preventDefault();
              setClientError(rc ? C['MFA-REC-ERR-FORMAT'] : C['MFA-LOGIN-ERR-FORMAT']);
              inputRef.current?.focus();
            }
          }}
        >
          {view.notice && <NoticeBox notice={view.notice} size={size} />}
          <Hidden fields={{ ...carry, intent: 'recheck', purpose: view.purpose, mode: view.mode }} />
          {rc ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="recheck-rc" className={OTP_LABEL_CLASS[size]}>
                {C['MFA-CHANGE-RC-LABEL']}
              </label>
              <p id="recheck-rc-hint" className={OTP_HINT_CLASS[size]}>
                {C['MFA-CHANGE-RC-HELP']}
              </p>
              <input
                ref={inputRef}
                id="recheck-rc"
                name="recoveryCode"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={20}
                aria-invalid={err ? true : undefined}
                aria-describedby={`recheck-desc recheck-rc-hint${err ? ' recheck-rc-error' : ''}`}
                className="h-12 w-full max-w-[320px] rounded-md border border-n-5 bg-n-0 px-4 font-mono text-xl uppercase tracking-wider text-n-9 outline-none focus:border-indigo focus:ring-2 focus:ring-indigo aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger"
                onChange={() => clientError && setClientError(null)}
              />
              {err && (
                <FieldError id="recheck-rc-error" size={size}>
                  {err}
                </FieldError>
              )}
            </div>
          ) : (
            <OtpCodeField
              id="recheck-otp"
              size={size}
              label={C['MFA-SEC-RECHECK-LABEL']}
              error={err}
              describedBy="recheck-desc"
              inputRef={inputRef}
              onEdit={() => clientError && setClientError(null)}
            />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pending={pending} label={C['MFA-TICKET-BTN']} busy={C['MFA-CONFIRM-BTN-BUSY']} className={s.primary} />
          </div>
        </form>
        {view.purpose === 'change' &&
          (canUseRc ? (
            <form action={formAction}>
              <Hidden fields={{ ...carry, intent: 'change', mode: rc ? 'otp' : 'rc' }} />
              <button type="submit" className={`${s.link} cursor-pointer`}>
                {rc ? C['MFA-CHANGE-USE-OTP'] : C['MFA-CHANGE-USE-RC']}
              </button>
            </form>
          ) : (
            <p className={s.body}>{C['MFA-CHANGE-NORC']}</p>
          ))}
        {backToStatus && backButton('status')}
      </div>
    );
  }

  if (view.step === 'qr' || view.step === 'qr_expired') {
    const hiddenEntry = { ...carry, entry: view.entry };
    if (view.step === 'qr_expired') {
      return (
        <div className="flex flex-col gap-5">
          {progress}
          {heading(C['MFA-QR-TITLE'])}
          {view.notice && <NoticeBox notice={view.notice} size={size} />}
          <div ref={alertRef} tabIndex={-1} role="alert" className={`${NOTICE} ${size === 'admin' ? 'text-[14px]' : ''} outline-none`}>
            <AlertIcon className={`mt-0.5 shrink-0 text-danger ${size === 'lg' ? 'size-6' : 'size-5'}`} />
            <p>{C['MFA-CONFIRM-ERR-EXPIRED']}</p>
          </div>
          <form action={formAction} className="flex flex-col gap-2">
            <Hidden fields={{ ...hiddenEntry, intent: 'renew' }} />
            <SubmitButton pending={pending} label={C['MFA-CONFIRM-REGEN']} busy={C['MFA-CONFIRM-BTN-BUSY']} className={s.primary} />
            <p className={s.body}>{C['MFA-CONFIRM-REGEN-NOTE']}</p>
          </form>
          {view.entry === 'B' ? backButton('prep', { entry: 'B' }) : backToStatus && backButton('status')}
        </div>
      );
    }
    const q = view.qr;
    const err =
      clientError ??
      (view.error === 'format'
        ? C['MFA-CONFIRM-ERR-FORMAT']
        : view.error === 'used'
          ? C['MFA-CONFIRM-ERR-USED']
          : view.error === 'wrong'
            ? withCount(C['MFA-CONFIRM-ERR-WRONG'], view.attemptsLeft)
            : null);
    const keyText = q.keyGroups.join('');
    return (
      <div className="flex flex-col gap-5">
        {progress}
        {heading(C['MFA-QR-TITLE'])}
        <ol className={`list-decimal pl-5 ${s.body}`}>
          <li>{C['MFA-QR-STEP-1']}</li>
          <li>{C['MFA-QR-STEP-2']}</li>
          <li>{C['MFA-QR-STEP-3']}</li>
        </ol>
        <svg
          role="img"
          aria-label={C['MFA-QR-ALT']}
          viewBox={`0 0 ${q.size} ${q.size}`}
          shapeRendering="crispEdges"
          className="mx-auto size-[208px] shrink-0 box-content rounded-md border border-n-3 bg-n-0 p-4"
        >
          <path d={q.path} fill="#000" />
        </svg>
        <p className={s.info}>{C['MFA-QR-PRIVACY']}</p>
        <details ref={manualRef} className={s.body}>
          <summary className={`flex min-h-12 cursor-pointer items-center text-indigo underline underline-offset-4 ${FOCUS_RING}`}>{C['MFA-QR-MANUAL-TITLE']}</summary>
          <div className="mt-2 flex flex-col gap-3">
            <p>{C['MFA-QR-MANUAL-1']}</p>
            <p>{C['MFA-QR-MANUAL-ACCOUNT']}</p>
            <div>
              <p className={s.strong}>{C['MFA-QR-MANUAL-KEY']}</p>
              <div aria-hidden="true" className="mt-1 grid select-all grid-cols-2 gap-x-4 gap-y-1 font-mono text-xl tracking-wide text-n-9 md:grid-cols-4">
                {q.keyGroups.map((g, i) => (
                  <span key={i}>{g}</span>
                ))}
              </div>
              <span className="sr-only">
                <SpokenCode code={keyText} groupSize={4} />
              </span>
            </div>
            <p>{C['MFA-QR-MANUAL-TYPE']}</p>
            {canCopy && (
              <button
                type="button"
                className={s.secondary}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(keyText);
                    setCopied(true);
                  } catch {
                    setCopyBroken(true);
                  }
                }}
              >
                {C['MFA-QR-COPY']}
              </button>
            )}
            <p id="copy-status" aria-live="polite" className="empty:hidden">
              {copied ? C['MFA-QR-COPIED'] : ''}
            </p>
          </div>
        </details>
        <div className="flex flex-col gap-2 md:hidden">
          <p className={s.body}>{C['MFA-QR-SAMEPHONE']}</p>
          <a
            href={q.otpauthUri}
            className={s.secondary}
            onClick={() => {
              if (manualRef.current) manualRef.current.open = true;
            }}
          >
            {C['MFA-QR-DEEPLINK']}
          </a>
          <p className={s.body}>{C['MFA-QR-DEEPLINK-HELP']}</p>
        </div>
        {(reset || view.entry === 'C') && <p className={s.body}>{C['MFA-CONFIRM-OLDITEM']}</p>}
        <form
          action={formAction}
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            if (!isOtp(normalizeOtp(inputRef.current?.value ?? ''))) {
              e.preventDefault();
              setClientError(C['MFA-CONFIRM-ERR-FORMAT']);
              inputRef.current?.focus();
            }
          }}
        >
          {view.notice && <NoticeBox notice={view.notice} size={size} />}
          <Hidden fields={{ ...hiddenEntry, intent: 'confirm', enrollmentId: q.enrollmentId }} />
          {view.entry === 'C' && (
            <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md border border-n-3 p-3">
              <input type="checkbox" name="rotate" defaultChecked={view.rotateDefault} className="mt-0.5 size-5 shrink-0 accent-indigo" />
              <span className={s.body}>{C['MFA-RC-ROTATE-OPT']}</span>
            </label>
          )}
          <OtpCodeField
            id="confirm-otp"
            size={size}
            label={C['MFA-CONFIRM-LABEL']}
            hint={C['MFA-CONFIRM-HELP']}
            error={err}
            inputRef={inputRef}
            onEdit={() => clientError && setClientError(null)}
          />
          {view.error === 'wrong' && <p className={s.body}>{C['MFA-CONFIRM-ERR-TIME']}</p>}
          <SubmitButton pending={pending} label={C['MFA-CONFIRM-BTN']} busy={C['MFA-CONFIRM-BTN-BUSY']} className={s.primary} />
        </form>
        {backButton('prep', { entry: view.entry, checkedWith: view.entry === 'C' ? (view.rotateDefault ? 'rc' : 'otp') : undefined })}
      </div>
    );
  }

  if (view.step === 'changed') {
    return (
      <div className="flex flex-col gap-5">
        {heading(P['APP-MFA-CHANGE-DONE-TITLE'])}
        <p className={s.body}>{P['APP-MFA-CHANGE-DONE-BODY']}</p>
        <p className={s.body}>{C['MFA-CONFIRM-OLDITEM']}</p>
        <form action={formAction}>
          <Hidden fields={{ ...carry, intent: 'done' }} />
          <button type="submit" className={s.primary}>
            {C['MFA-RC-NEXT']}
          </button>
        </form>
      </div>
    );
  }

  // codes
  return (
    <div className="flex flex-col gap-5">
      {progress}
      {heading(C['MFA-RC-TITLE'])}
      <RecoveryCodeList
        codes={view.codes}
        issuedOn={view.issuedOn}
        name={view.name}
        size={size}
        hidden={Object.fromEntries(Object.entries({ ...carry, intent: 'ack' }).filter((e): e is [string, string] => e[1] !== undefined))}
        formAction={formAction}
        pending={pending}
        primaryClass={s.primary}
        secondaryClass={s.secondary}
        lead={view.reason === 'reenroll' || view.reason === 'change' ? <p className={s.body}>{view.reason === 'reenroll' ? C['MFA-REENROLL-DONE'] : C['MFA-CONFIRM-OLDITEM']}</p> : undefined}
      />
    </div>
  );
}

// 로그인 중 등록(입구 B, /sign-in/otp-setup). 첫 단계는 서버(페이지)가 정한다.
export default function OtpSetupFlow({ initial, redirectTo, reset }: { initial: Exclude<SetupView, { step: 'status' }>; redirectTo: string | null; reset: boolean }) {
  const [view, formAction, pending] = useActionState<SetupView, FormData>(otpSetupStep, initial);
  const [first] = useState(view);
  const body = view.step === 'status' ? initial : view;
  return (
    <SetupBody
      view={body}
      formAction={formAction}
      pending={pending}
      size="lg"
      carry={{ redirect: redirectTo ?? undefined, reason: reset ? 'reset' : undefined }}
      reset={reset}
      focus={view !== first}
    />
  );
}
