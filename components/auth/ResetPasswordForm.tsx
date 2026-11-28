'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { resetPassword, type ResetPasswordError, type ResetPasswordState } from '@/app/actions/auth';
import PasswordField from '@/components/auth/PasswordField';
import { ConfirmNote, usePasswordConfirm } from '@/components/auth/usePasswordConfirm';
import { NOTICE } from '@/components/auth/styles';
import { AlertIcon, RefreshIcon } from '@/components/error/icons';
import { PRIMARY_BTN, SECONDARY_BTN } from '@/components/error/styles';
import { FIELD_MESSAGES, LIMITS, MSG_PASSWORD_MISMATCH_CLIENT } from '@/lib/form-messages';

// 재설정 메일 링크(/reset-password?token=)의 새 비밀번호 화면(정의서 3장, 디자인 스펙 P-2, 카피 문서 4장 RP-*).
// 큰 글씨 계열(PasswordField)로 맞추고, 두 칸이 [보기] 상태를 공유한다(가입 폼과 같은 규칙).
// 비밀번호는 제어 입력이라 오류 응답 뒤에도 지워지지 않는다 — 그래서 RP-ERR-UNAVAILABLE의 "입력한 내용은 그대로예요"가 사실이다.
// 토큰은 hidden 입력 한 곳에만 있다. 이 화면에는 외부 링크·외부 스크립트를 두지 않는다(URL 토큰이 Referer로 새지 않게).

const NOTE_ID = 'reset-note';
const PW_ERROR_ID = 'reset-password-error';
const CONFIRM_ERROR_ID = 'reset-confirm-note';

const FIELD_ERROR_COPY: Partial<Record<ResetPasswordError, string>> = {
  short: '비밀번호는 8자 이상이어야 해요',
  long: `비밀번호는 ${LIMITS.password}자 이하로 입력해 주세요`,
  rule: FIELD_MESSAGES.password,
};

export default function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<ResetPasswordState, FormData>(resetPassword, undefined);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [shown, setShown] = useState(false);
  const [shortError, setShortError] = useState(false);
  const { note, warned, compare, pwRef, confirmRef, invalid: confirmInvalid } = usePasswordConfirm();

  const serverError = state?.error ?? null;
  const pwError = shortError ? FIELD_ERROR_COPY.short : serverError ? FIELD_ERROR_COPY[serverError] : undefined;
  // 서버가 돌려준 불일치(JS 없이 제출한 경우)는 화면 비교 결과가 없을 때만 보인다.
  const serverMismatch = serverError === 'mismatch' && note === 'none';

  // 서버 응답의 칸 오류는 그 칸으로 포커스. 만료·연결 불가 알림은 role=alert가 읽으므로 옮기지 않는다(P-5).
  useEffect(() => {
    if (!state) return;
    if (state.error === 'short' || state.error === 'long' || state.error === 'rule') pwRef.current?.focus();
    else if (state.error === 'mismatch') confirmRef.current?.focus();
  }, [state, pwRef, confirmRef]);

  return (
    <form
      action={formAction}
      className="mt-6 flex flex-col gap-5"
      onSubmit={(e) => {
        // 제출 때 평문이 화면에 남지 않게 숨김으로 되돌린다(값은 그대로).
        setShown(false);
        if (password.length < 8) {
          e.preventDefault();
          setShortError(true);
          pwRef.current?.focus();
          return;
        }
        setShortError(false);
        const result = compare({ emptyIsError: true });
        if (result === 'mismatch' || result === 'empty') {
          e.preventDefault();
          confirmRef.current?.focus();
        }
      }}
    >
      <input type="hidden" name="token" value={token} />

      {/* 알림이 폼 맨 위 — 알림 안 [재설정 메일 다시 받기]가 첫 탭 대상이 된다(P-2.2). */}
      {serverError === 'expired' && (
        <div role="alert" className={`${NOTICE} flex-col`}>
          <div className="flex gap-3">
            <AlertIcon className="mt-0.5 size-6 shrink-0 text-danger-strong" />
            <div className="flex flex-col gap-1">
              <p>비밀번호를 바꾸지 못했어요. 링크가 만료됐거나 이미 썼을 수 있어요. 새 메일을 받아 주세요.</p>
              <p className="text-n-7">링크는 1시간 동안, 한 번만 쓸 수 있어요.</p>
            </div>
          </div>
          <Link href="/forgot-password" className={`${SECONDARY_BTN} mt-1`}>
            재설정 메일 다시 받기
          </Link>
        </div>
      )}
      {serverError === 'unavailable' && (
        <div role="alert" className={NOTICE}>
          <AlertIcon className="mt-0.5 size-6 shrink-0 text-danger-strong" />
          <p>지금 연결이 원활하지 않아요. 입력한 내용은 그대로예요. 잠시 후 다시 눌러 주세요.</p>
        </div>
      )}

      <p id={NOTE_ID} className="text-base leading-[1.7] text-n-7 break-keep">
        새 비밀번호를 정해 주세요. 변경하면 모든 기기에서 로그아웃돼요.
      </p>

      <div className="flex flex-col gap-2">
        <PasswordField
          id="reset-password"
          name="password"
          label="새 비밀번호"
          hint="8자 이상 입력해 주세요"
          shown={shown}
          onToggle={() => setShown((v) => !v)}
          toggleName="비밀번호"
          controls="reset-password reset-confirm"
          autoComplete="new-password"
          required
          maxLength={LIMITS.password}
          invalid={Boolean(pwError)}
          describedBy={pwError ? `${NOTE_ID} ${PW_ERROR_ID}` : NOTE_ID}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (e.target.value.length >= 8) setShortError(false);
            if (warned) compare({ emptyIsError: false });
          }}
          ref={pwRef}
        />
        {pwError && (
          <p id={PW_ERROR_ID} role="alert" className="flex gap-2 text-base leading-[1.6] text-n-9 break-keep">
            <AlertIcon className="mt-0.5 size-5 shrink-0 text-danger-strong" />
            {pwError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <PasswordField
          id="reset-confirm"
          name="confirm"
          label="새 비밀번호 확인"
          shown={shown}
          onToggle={() => setShown((v) => !v)}
          toggleName="비밀번호"
          controls="reset-password reset-confirm"
          autoComplete="new-password"
          required
          maxLength={LIMITS.password}
          invalid={confirmInvalid || serverMismatch}
          describedBy={confirmInvalid || serverMismatch ? `${NOTE_ID} ${CONFIRM_ERROR_ID}` : NOTE_ID}
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            if (warned) compare({ emptyIsError: false });
          }}
          onBlur={() => compare({ emptyIsError: false })}
          ref={confirmRef}
        />
        {serverMismatch ? (
          <p id={CONFIRM_ERROR_ID} role="alert" className="flex gap-2 text-base leading-[1.6] text-n-9 break-keep">
            <AlertIcon className="mt-0.5 size-5 shrink-0 text-danger-strong" />
            {MSG_PASSWORD_MISMATCH_CLIENT}
          </p>
        ) : (
          <ConfirmNote id={CONFIRM_ERROR_ID} note={note} />
        )}
      </div>

      <button type="submit" disabled={pending} aria-busy={pending} className={`${PRIMARY_BTN} disabled:cursor-not-allowed disabled:opacity-60`}>
        {pending ? (
          <>
            <RefreshIcon className="size-5 animate-spin motion-reduce:animate-none" />
            변경하는 중이에요
          </>
        ) : (
          '비밀번호 변경'
        )}
      </button>
    </form>
  );
}
