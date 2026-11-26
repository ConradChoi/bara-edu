'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { requestPasswordReset, type ForgotPasswordError, type ForgotPasswordState } from '@/app/actions/auth';
import { siteConfig } from '@/data/site-config';
import { FOCUS_RING, INPUT_LG } from '@/components/auth/PasswordField';
import SupportPhone from '@/components/auth/SupportPhone';
import { NOTICE, NOTICE_INFO, PAGE_TITLE_CLASS, STATUS_TITLE_CLASS } from '@/components/auth/styles';
import { AlertIcon, CheckIcon, RefreshIcon } from '@/components/error/icons';
import { LINK_CLASS, PRIMARY_BTN, SECONDARY_BTN } from '@/components/error/styles';
import { isApiEmail, LIMITS } from '@/lib/form-messages';

// 비밀번호 찾기(/forgot-password). 정의서 2장, 디자인 스펙 P-1·P-5, 카피 문서 1~2장(FP-*).
// 열거 방지: 서버가 200이면 가입 여부·이메일 한도와 관계없이 늘 같은 "보냄" 화면이다. 화면은 입력한 이메일 말고 서버 값을 쓰지 않는다.
// JS 없이도 <form action>(서버 액션)으로 제출되고 결과 화면이 서버에서 그려진다(인앱 브라우저 대비). 카운트다운만 JS가 있을 때 동작한다.

const COPY = {
  title: '비밀번호 찾기',
  desc: '가입한 이메일 주소를 입력해 주세요. 비밀번호를 새로 정하는 링크를 보내 드려요.',
  label: '가입한 이메일',
  help: '휴대폰 본인인증이나 이름·연락처는 묻지 않아요. 가입한 이메일만 있으면 돼요.',
  submit: '재설정 메일 받기',
  busy: '보내는 중이에요',
  toSignIn: '로그인 화면으로',
  foot: '이메일 주소가 기억나지 않거나 메일함을 열 수 없다면 전화로 문의해 주세요.',
  sentTitle: '메일함을 확인해 주세요',
  sentBodyAfter: '로 안내를 보냈어요. 가입한 이메일이 맞다면 몇 분 안에 비밀번호를 새로 정하는 링크가 도착해요. 링크는 1시간 동안 쓸 수 있어요.',
  sentIgnore: '본인이 요청하지 않았다면 따로 하실 일은 없어요.',
  noMailTitle: '메일이 오지 않나요?',
  noMail: ['몇 분이 지나도 없다면 스팸메일함을 확인해 주세요.', '위에 적힌 이메일 주소가 맞는지 확인해 주세요.', '그래도 없으면 전화로 문의해 주세요.'],
  resend: '메일 다시 받기',
  resendWait: '1분 뒤에 다시 받을 수 있어요. 여러 번 눌러도 메일이 빨리 오지 않아요.',
  resendReady: '이제 메일을 다시 받을 수 있어요.',
  resendDone: '다시 요청했어요. 몇 분 안에 오지 않으면 스팸메일함을 확인해 주세요.',
  other: '다른 이메일로 다시 입력하기',
} as const;

// 입력값은 제어 입력으로 유지하므로 "입력한 이메일은 그대로예요"가 사실이다(카피 문서 6장).
const ERROR_COPY: Record<ForgotPasswordError, string> = {
  empty: '이메일을 입력해 주세요',
  format: '올바른 이메일 형식이 아니에요. 예: name@example.com',
  rate_limited: '요청이 많아요. 잠시 후 다시 시도해 주세요. 입력한 이메일은 그대로예요.',
  unavailable: '지금 연결이 원활하지 않아요. 입력한 이메일은 그대로예요. 잠시 후 다시 눌러 주세요.',
  failed: `메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요. 계속 안 되면 전화로 문의해 주세요. 전화 ${siteConfig.phone}`,
};

// 서버 reset-60s(이메일당 60초 1회)와 맞춘다.
const RESEND_WAIT_SECONDS = 60;

type FieldError = 'empty' | 'format';
const isFieldError = (e: ForgotPasswordError): e is FieldError => e === 'empty' || e === 'format';

export default function ForgotPasswordForm({ loggedIn = false }: { loggedIn?: boolean }) {
  const [state, formAction, pending] = useActionState<ForgotPasswordState, FormData>(requestPasswordReset, undefined);
  // JS 없이 서버가 다시 그릴 때(오류 응답)도 칸을 채워 둔다. 이후로는 제어 입력이라 응답이 와도 지워지지 않는다.
  const [email, setEmail] = useState(() => (state && 'error' in state && !state.resend ? state.email : ''));
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  // [다른 이메일로 다시 입력]을 누른 시점의 상태. 새 응답이 오면 자동으로 풀린다.
  const [editingFor, setEditingFor] = useState<ForgotPasswordState | null>(null);
  // 다시 받기 카운트다운. for가 지금 상태와 같을 때만 유효하다(새 응답마다 다시 시작).
  const [clock, setClock] = useState<{ for: ForgotPasswordState; left: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentTitleRef = useRef<HTMLHeadingElement>(null);

  const editing = editingFor !== null && editingFor === state;
  const requested = state && 'requested' in state ? state : null;
  const resendError = state && 'error' in state && state.resend ? state.error : null;
  const sentEmail = state ? state.email : '';
  const showSent = !editing && (requested !== null || resendError !== null);

  // 화면 전환·응답 직후 포커스(P-5). 첫 보냄 → 제목, 칸 오류(서버) → 칸. 다시 받기는 포커스를 버튼에 둔다.
  useEffect(() => {
    if (!state) return;
    if ('requested' in state && !state.resend) sentTitleRef.current?.focus();
    else if ('error' in state && !state.resend && isFieldError(state.error)) inputRef.current?.focus();
  }, [state]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // 보냄(200)마다 60초 카운트를 새로 시작한다. 숫자는 눈으로만 보이고, 스크린리더에는 끝날 때 한 번만 알린다.
  useEffect(() => {
    if (!requested) return;
    const end = Date.now() + RESEND_WAIT_SECONDS * 1000;
    const tick = () => setClock({ for: requested, left: Math.max(0, Math.ceil((end - Date.now()) / 1000)) });
    const first = setTimeout(tick, 0);
    const id = setInterval(() => {
      tick();
      if (Date.now() >= end) clearInterval(id);
    }, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [requested]);

  if (showSent) {
    // null: 카운트가 없다(JS 없음·첫 렌더). 버튼은 활성이고 서버 한도가 막는다(정의서 7장).
    const remaining = clock && clock.for === state ? clock.left : null;
    const waiting = remaining !== null && remaining > 0;
    const statusMsg = remaining === 0 ? COPY.resendReady : requested?.resend ? COPY.resendDone : '';
    return (
      <section aria-labelledby="forgot-sent-title" className="flex flex-col">
        <div className="flex size-14 items-center justify-center rounded-pill bg-n-1 text-indigo md:size-16">
          <CheckIcon className="size-7 md:size-8" />
        </div>
        <h1 id="forgot-sent-title" ref={sentTitleRef} tabIndex={-1} className={STATUS_TITLE_CLASS}>
          {COPY.sentTitle}
        </h1>
        <div className={`${NOTICE_INFO} mt-3`}>
          <p>
            <span className="break-all font-semibold">{sentEmail}</span>
            {COPY.sentBodyAfter}
          </p>
        </div>
        <p className="mt-3 text-lg leading-[1.7] text-n-7 break-keep">{COPY.sentIgnore}</p>

        <h2 className="mt-5 text-base font-semibold text-n-9">{COPY.noMailTitle}</h2>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-base leading-[1.7] text-n-7 break-keep">
          {COPY.noMail.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>

        <div className="mt-8 flex flex-col gap-3">
          {resendError && (
            <div role="alert" className={NOTICE}>
              <AlertIcon className="mt-0.5 size-6 shrink-0 text-danger" />
              <p>{ERROR_COPY[isFieldError(resendError) ? 'failed' : resendError]}</p>
            </div>
          )}
          <form
            action={formAction}
            onSubmit={(e) => {
              if (waiting) e.preventDefault();
            }}
          >
            <input type="hidden" name="email" value={sentEmail} />
            <input type="hidden" name="resend" value="1" />
            <button
              type="submit"
              disabled={pending}
              aria-busy={pending}
              aria-disabled={waiting ? true : undefined}
              aria-describedby={remaining !== 0 ? 'resend-hint' : undefined}
              className={`${SECONDARY_BTN} disabled:cursor-not-allowed disabled:opacity-60 ${waiting ? '!cursor-not-allowed opacity-60' : ''}`}
            >
              {pending ? (
                <>
                  <RefreshIcon className="size-5 animate-spin motion-reduce:animate-none" />
                  {COPY.busy}
                </>
              ) : (
                COPY.resend
              )}
            </button>
          </form>
          {remaining !== 0 && (
            <p id="resend-hint" className="text-sm leading-[1.6] text-n-6 break-keep">
              {COPY.resendWait}
              {waiting && <span aria-hidden="true"> {remaining}초</span>}
            </p>
          )}
          <div id="resend-status" aria-live="polite" className={statusMsg ? NOTICE_INFO : undefined}>
            {statusMsg}
          </div>
          <a
            href="/forgot-password"
            className={`${LINK_CLASS} self-start`}
            onClick={(e) => {
              // JS가 있으면 같은 화면에서 입력으로 돌아간다(칸 비움). 없으면 새로 연 입력 화면이 같은 결과다.
              e.preventDefault();
              setEmail('');
              setFieldError(null);
              setEditingFor(state);
            }}
          >
            {COPY.other}
          </a>
          <Link href="/sign-in" className={`${LINK_CLASS} self-start`}>
            {COPY.toSignIn}
          </Link>
          <SupportPhone hoursLabel="운영시간" />
        </div>
      </section>
    );
  }

  const serverError = !editing && state && 'error' in state && !state.resend ? state.error : null;
  const shownFieldError = fieldError ?? (serverError && isFieldError(serverError) ? serverError : null);
  const noticeError = serverError && !isFieldError(serverError) ? serverError : null;
  const describedBy = shownFieldError ? 'forgot-email-hint forgot-email-error' : 'forgot-email-hint';

  return (
    <section aria-labelledby="forgot-title" className="flex flex-col">
      <h1 id="forgot-title" tabIndex={-1} className={PAGE_TITLE_CLASS}>
        {COPY.title}
      </h1>
      <p id="forgot-desc" className="mt-3 text-lg leading-[1.7] text-n-7 break-keep">
        {COPY.desc}
      </p>

      <form
        action={formAction}
        className="mt-8 flex flex-col gap-5"
        onSubmit={(e) => {
          const v = email.trim();
          const err: FieldError | null = !v ? 'empty' : isApiEmail(v) ? null : 'format';
          setFieldError(err);
          if (err) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        {noticeError && (
          <div role="alert" className={NOTICE}>
            <AlertIcon className="mt-0.5 size-6 shrink-0 text-danger" />
            <p>{ERROR_COPY[noticeError]}</p>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="forgot-email" className="text-base font-semibold text-n-9">
            {COPY.label}
          </label>
          <p id="forgot-email-hint" className="text-sm leading-[1.6] text-n-6 break-keep">
            {COPY.help}
          </p>
          <input
            ref={inputRef}
            id="forgot-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={LIMITS.email}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => {
              const v = email.trim();
              if (v && !isApiEmail(v)) setFieldError('format');
            }}
            // 브라우저 검증은 보조로 남기되(JS 없을 때), JS가 있으면 말풍선 대신 칸 아래 안내를 쓴다.
            onInvalid={(e) => {
              e.preventDefault();
              setFieldError(e.currentTarget.validity.valueMissing ? 'empty' : 'format');
              inputRef.current?.focus();
            }}
            aria-invalid={shownFieldError ? true : undefined}
            aria-describedby={describedBy}
            className={INPUT_LG.replace(' pr-[76px]', '')}
          />
          {/* role="alert": Enter로 제출하면 칸에 이미 포커스가 있어 aria-describedby만으로는 새 오류가 읽히지 않는다(P-5). */}
          {shownFieldError && (
            <p id="forgot-email-error" role="alert" className="mt-1 flex gap-2 text-base leading-[1.6] text-n-9 break-keep">
              <AlertIcon className="mt-0.5 size-5 shrink-0 text-danger" />
              {ERROR_COPY[shownFieldError]}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className={`${PRIMARY_BTN} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {pending ? (
            <>
              <RefreshIcon className="size-5 animate-spin motion-reduce:animate-none" />
              {COPY.busy}
            </>
          ) : (
            COPY.submit
          )}
        </button>
        {(noticeError === 'unavailable' || noticeError === 'failed') && <SupportPhone hoursLabel="운영시간" />}
      </form>

      <Link href="/sign-in" className={`${LINK_CLASS} mt-1 self-start`}>
        {COPY.toSignIn}
      </Link>

      {loggedIn && (
        <p className={`${NOTICE_INFO} mt-5`}>
          로그인한 상태라면{' '}
          <Link href="/my" className={`text-indigo underline underline-offset-4 ${FOCUS_RING}`}>
            마이페이지
          </Link>
          에서 바꿀 수 있어요.
        </p>
      )}

      <div className="mt-5 flex flex-col gap-3 border-t border-n-3 pt-5">
        <p className="text-base leading-[1.7] text-n-7 break-keep">{COPY.foot}</p>
        <SupportPhone hoursLabel="운영시간" />
      </div>
    </section>
  );
}
