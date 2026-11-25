'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { finishSignup, type SignupFinishState } from '@/app/actions/auth';
import { siteConfig } from '@/data/site-config';
import PasswordField, { FOCUS_RING } from '@/components/auth/PasswordField';
import SignupLinkStatus from '@/components/auth/SignupLinkStatus';
import { AlertIcon, ChevronDownIcon, PhoneIcon, RefreshIcon } from '@/components/error/icons';
import { SECONDARY_BTN } from '@/components/error/styles';

const initialState: SignupFinishState = undefined;
const MAX_ATTEMPTS = 5;

const NOTICE = 'flex gap-3 rounded-md border-l-4 border-danger bg-n-1 px-4 py-3 text-base leading-[1.6] text-n-9 break-keep';

type Props = {
  token: string;
  email: string;
  // 서버가 미리 만든 문자열(하이드레이션 어긋남 방지)
  requestedLabel: string;
  remainingLabel: string | null;
  attemptsLeft: number;
};

// 가입 마무리 입력 화면(상태 ready + 비밀번호 틀림). 확정은 서버 액션(POST)에서만 일어난다.
// 비밀번호는 state로만 들고(제출 값 유지용) 서버 응답 상태에는 담지 않는다. 토큰은 hidden 입력으로 넘기며 번들·로그에 없다.
export default function SignupFinishForm({ token, email, requestedLabel, remainingLabel, attemptsLeft: initialLeft }: Props) {
  const [password, setPassword] = useState('');
  // 틀린 응답이면 입력 칸을 비운다. 연결 오류·429는 입력을 그대로 둔다(그래서 "입력한 내용은 그대로예요"가 사실이다).
  const [state, formAction, pending] = useActionState(async (prev: SignupFinishState, fd: FormData) => {
    const next = await finishSignup(prev, fd);
    if (next?.kind === 'wrong_password') setPassword('');
    return next;
  }, initialState);
  const [shown, setShown] = useState(false);
  const [emptyError, setEmptyError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const wrong = state?.kind === 'wrong_password' ? state : null;
  const attemptsLeft = wrong ? wrong.attemptsLeft : initialLeft;
  const failKind = state?.kind === 'error' && state.error !== 'empty' ? state.error : null;
  const showEmpty = emptyError || (state?.kind === 'error' && state.error === 'empty');
  const invalid = Boolean(wrong) || showEmpty;

  // 응답이 올 때마다(새 state 객체) 입력 칸으로 포커스.
  useEffect(() => {
    if (!state || state.kind === 'status') return;
    inputRef.current?.focus();
  }, [state]);

  if (state?.kind === 'status') {
    return <SignupLinkStatus status={state.status} focusOnMount />;
  }

  const digits = siteConfig.phone.replace(/[^0-9]/g, '');
  const describedBy = wrong ? 'confirm-password-error' : showEmpty ? 'confirm-password-empty' : undefined;

  return (
    <section aria-labelledby="confirm-title" className="flex flex-col">
      <h1 id="confirm-title" tabIndex={-1} className="text-2xl font-bold leading-[1.35] text-n-9 break-keep outline-none md:text-[28px]">
        가입을 마무리해 주세요
      </h1>
      <p className="mt-3 text-lg leading-[1.7] text-n-7 break-keep">가입할 때 정한 비밀번호를 입력하면 가입이 끝나요.</p>

      <dl className="mt-6 rounded-lg bg-n-1 px-4 py-4 text-base leading-[1.6]">
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-n-6">가입 이메일</dt>
          <dd className="break-all font-semibold text-n-9">{email}</dd>
        </div>
        {requestedLabel && (
          <div className="mt-3 flex flex-col gap-0.5">
            <dt className="text-sm text-n-6">가입 요청</dt>
            <dd className="text-n-9">{requestedLabel}</dd>
          </div>
        )}
        {remainingLabel && (
          <div className="mt-3 flex flex-col gap-0.5">
            <dt className="text-sm text-n-6">남은 시간</dt>
            <dd className="text-n-9">{remainingLabel}</dd>
          </div>
        )}
      </dl>

      <form
        action={formAction}
        noValidate
        className="mt-6 flex flex-col"
        onSubmit={(e) => {
          if (!password) {
            e.preventDefault();
            setEmptyError(true);
            inputRef.current?.focus();
            return;
          }
          setEmptyError(false);
        }}
      >
        <input type="hidden" name="token" value={token} />
        {/* 비밀번호 관리자가 이메일과 짝지을 수 있게 둔다. display:none이면 무시되므로 sr-only. */}
        <input type="email" name="username" autoComplete="username" defaultValue={email} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />

        {wrong && (
          <div id="confirm-password-error" className={`${NOTICE} mb-3 flex-col`}>
            <div className="flex gap-3">
              <AlertIcon className="mt-0.5 size-6 shrink-0 text-danger" />
              <p className="font-semibold">비밀번호가 맞지 않아요.</p>
            </div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-9">
              <span className="text-lg font-bold">
                {wrong.attemptsLeft === 1 ? '마지막 1번 남았어요. 천천히 확인해 주세요.' : `${wrong.attemptsLeft}번 더 입력해 볼 수 있어요.`}
              </span>
              <span className="flex gap-1.5" aria-hidden="true">
                {Array.from({ length: MAX_ATTEMPTS }, (_, i) => (
                  <span key={i} className={`size-3 rounded-pill ${i < MAX_ATTEMPTS - wrong.attemptsLeft ? 'bg-n-9' : 'border-2 border-n-9 bg-n-0'}`} />
                ))}
              </span>
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-14 pr-1 text-base leading-[1.7] text-n-7">
              <li>가입할 때 정한 비밀번호가 맞는지 확인해 주세요. 한/영 키와 Caps Lock이 켜져 있는지도 살펴봐 주세요.</li>
              <li>다른 인증 메일을 받았다면 그 메일의 링크도 열어 보세요.</li>
              {wrong.attemptsLeft <= 2 && <li>비밀번호가 기억나지 않으면 아래에서 다시 가입할 수 있어요.</li>}
            </ul>
          </div>
        )}
        {failKind && (
          <div role="alert" className={`${NOTICE} mb-3`}>
            <AlertIcon className="mt-0.5 size-6 shrink-0 text-danger" />
            <p>
              {failKind === 'unavailable'
                ? '지금 연결이 원활하지 않아요. 입력한 내용은 그대로예요. 잠시 후 다시 눌러 주세요.'
                : failKind === 'rate_limited'
                  ? '요청이 많아요. 잠시 후 다시 시도해 주세요. 입력한 횟수에는 포함되지 않아요.'
                  : '처리 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.'}
            </p>
          </div>
        )}

        <PasswordField
          id="confirm-password"
          name="password"
          label="비밀번호"
          hint="가입할 때 정한 비밀번호"
          shown={shown}
          onToggle={() => setShown((v) => !v)}
          toggleName="비밀번호"
          autoComplete="current-password"
          required
          maxLength={200}
          invalid={invalid}
          describedBy={describedBy}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (e.target.value) setEmptyError(false);
          }}
          ref={inputRef}
        />
        {showEmpty && (
          <p id="confirm-password-empty" className="mt-2 flex gap-2 text-base leading-[1.6] text-n-9">
            <AlertIcon className="mt-0.5 size-5 shrink-0 text-danger" />
            비밀번호를 입력해 주세요
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className={`mt-6 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-pill bg-indigo px-6 text-lg font-bold text-n-0 hover:bg-arc-1 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
        >
          {pending ? (
            <>
              <RefreshIcon className="size-5 animate-spin motion-reduce:animate-none" />
              확인하고 있어요
            </>
          ) : (
            '가입 완료하기'
          )}
        </button>
      </form>

      <details className="group mt-8 rounded-lg border border-n-3" open={attemptsLeft <= 2 ? true : undefined}>
        <summary
          className={`flex min-h-14 cursor-pointer list-none items-center justify-between px-4 py-3 text-lg font-semibold text-n-9 hover:bg-n-1 ${FOCUS_RING} [&::-webkit-details-marker]:hidden`}
        >
          비밀번호가 기억나지 않아요
          <ChevronDownIcon className="size-5 shrink-0 text-indigo transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="flex flex-col gap-4 border-t border-n-3 px-4 py-4">
          <p className="text-base leading-[1.7] text-n-7 break-keep">
            처음부터 다시 가입하면 새 인증 메일을 보내 드려요. 그 메일에서 새로 정한 비밀번호로 가입을 마칠 수 있어요.
          </p>
          <Link href={`/sign-up?email=${encodeURIComponent(email)}`} className={SECONDARY_BTN}>
            처음부터 다시 가입하기
          </Link>
          <p className="text-base leading-[1.7] text-n-7 break-keep">다시 가입이 어려우면 전화로 문의해 주세요.</p>
          <a href={`tel:${digits}`} className={SECONDARY_BTN}>
            <PhoneIcon className="size-6" />
            전화 문의 {siteConfig.phone}
          </a>
          <p className="text-sm leading-[1.6] text-n-6 break-keep">운영시간 {siteConfig.supportHours}</p>
        </div>
      </details>

      <p className="mt-8 border-t border-n-3 pt-5 text-base leading-[1.7] text-n-7 break-keep">
        본인이 가입을 요청하지 않았다면 이 화면을 닫아 주세요. 아무것도 바뀌지 않아요.
      </p>
    </section>
  );
}
