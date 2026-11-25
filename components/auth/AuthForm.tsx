'use client';

import { useActionState, useRef, useState } from 'react';
import Link from 'next/link';
import { signup, login, type AuthFormState } from '@/app/actions/auth';
import { siteConfig } from '@/data/site-config';
import ResendConfirmationForm from '@/components/auth/ResendConfirmationForm';
import PasswordField from '@/components/auth/PasswordField';
import { AlertIcon, CheckIcon } from '@/components/error/icons';
import { MSG_PASSWORD_MISMATCH_CLIENT } from '@/lib/form-messages';

const initialState: AuthFormState = undefined;

type AuthFormProps = {
  mode: 'signup' | 'signin';
  redirectTo?: string;
  // 가입 폼의 이메일 칸 미리 채움(가입 마무리 화면의 "처음부터 다시 가입하기"가 넘김)
  defaultEmail?: string;
};

// 비밀번호 확인 칸의 안내. 'empty'·'mismatch'는 오류, 'match'는 한 번 불일치가 뜬 뒤 고쳤을 때만.
type ConfirmNote = 'none' | 'empty' | 'mismatch' | 'match';

export default function AuthForm({ mode, redirectTo, defaultEmail }: AuthFormProps) {
  const action = mode === 'signup' ? signup : login;
  const [state, formAction, pending] = useActionState(action, initialState);
  // 두 비밀번호 칸의 [보기]는 같은 상태를 공유한다 — 어느 쪽을 눌러도 두 칸이 함께 보이고 숨겨진다(대표 판단).
  const [shown, setShown] = useState(false);
  const [note, setNote] = useState<ConfirmNote>('none');
  const [warned, setWarned] = useState(false); // 한 번이라도 불일치 안내가 떴는지 — 이후에는 입력할 때마다 다시 비교
  const pwRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  // 입력 도중에는 불일치를 띄우지 않는다. blur·제출 때 비교하고, 한 번 뜬 뒤에는 입력할 때마다 비교한다.
  function compare(opts: { emptyIsError: boolean }): ConfirmNote {
    const a = pwRef.current?.value ?? '';
    const b = confirmRef.current?.value ?? '';
    let next: ConfirmNote;
    if (!b) next = opts.emptyIsError ? 'empty' : 'none';
    else if (a !== b) next = 'mismatch';
    else next = warned ? 'match' : 'none';
    if (next === 'mismatch' || next === 'empty') setWarned(true);
    setNote(next);
    return next;
  }

  if (state && 'pendingConfirmation' in state) {
    // 로그인 쪽은 메일을 새로 보내지 않았으므로 "보냈어요"라고 하지 않는다(문구 문서 4장 코드 요청 3, 방법 A).
    // 가입 쪽은 가입 여부를 숨기려고 신규·기존 모두 같은 문구를 쓴다(대표 결정 2026-11-25).
    if (state.source === 'login') {
      return (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <p className="text-[15px] font-semibold text-n-9">이메일 인증이 아직 끝나지 않았어요</p>
            <p className="text-[14px] leading-relaxed text-n-7">
              받은 인증 메일의 링크를 눌러 주세요. 링크를 열면 가입할 때 정한 비밀번호를 한 번 더 입력해요. 메일이 없으면 아래에서 다시 받을 수 있어요.
            </p>
          </div>
          <div className="flex flex-col gap-2 border-t border-n-3 pt-4">
            <ResendConfirmationForm defaultEmail={state.email} />
          </div>
          <Link href="/sign-in" className="text-center text-[13px] font-medium text-pink">
            로그인 화면으로
          </Link>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-[15px] font-semibold text-n-9">메일을 보냈어요</p>
          <p className="text-[14px] leading-relaxed text-n-7">
            <span className="font-semibold text-n-9">{state.email}</span>로 안내 메일을 보냈어요. 메일함을 확인해 주세요.
          </p>
          <p className="text-[14px] leading-relaxed text-n-7">
            가입이 처음이면 메일 안의 링크를 열고, 방금 정한 비밀번호를 한 번 더 입력해 주세요. 그러면 가입이 끝나요.
          </p>
        </div>
        <div className="flex flex-col gap-1 text-[12.5px] leading-relaxed text-n-6">
          <p>몇 분이 지나도 메일이 없다면 스팸메일함을 확인해 주세요.</p>
          <p>입력한 이메일 주소가 맞는지도 확인해 주세요.</p>
          <p>
            그래도 없으면 전화로 문의해 주세요. {siteConfig.phone}
            {siteConfig.supportHours ? ` (${siteConfig.supportHours})` : ''}
          </p>
        </div>
        <div className="flex flex-col gap-2 border-t border-n-3 pt-4">
          <p className="text-[12.5px] text-n-6">메일이 오지 않았거나 인증 링크가 만료됐나요? 아래에서 메일을 다시 받을 수 있어요.</p>
          <ResendConfirmationForm defaultEmail={state.email} />
        </div>
        <div className="flex flex-col items-center gap-2">
          <Link href="/sign-in" className="text-center text-[13px] font-medium text-pink">
            로그인 화면으로
          </Link>
          <Link href="/sign-up" className="text-center text-[12.5px] text-n-6 underline">
            이메일 주소를 잘못 썼다면 처음부터 다시 쓰기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        if (mode !== 'signup') return;
        // 제출 때 평문이 화면에 남지 않게 숨김으로 되돌린다(값은 그대로).
        setShown(false);
        const result = compare({ emptyIsError: true });
        if (result === 'mismatch' || result === 'empty') {
          e.preventDefault();
          confirmRef.current?.focus();
        }
      }}
    >
      {mode === 'signup' && (
        <Field label="이름" name="name" placeholder="이름을 입력하세요" required />
      )}
      <Field
        label="이메일"
        name="email"
        type="email"
        placeholder="name@example.com"
        required
        defaultValue={mode === 'signup' ? defaultEmail : undefined}
      />
      {mode === 'signup' ? (
        <>
          <PasswordField
            id="password"
            name="password"
            label="비밀번호"
            hint="8자 이상 입력해 주세요"
            shown={shown}
            onToggle={() => setShown((v) => !v)}
            toggleName="비밀번호"
            controls="password passwordConfirm"
            autoComplete="new-password"
            required
            maxLength={200}
            ref={pwRef}
            onChange={() => warned && compare({ emptyIsError: false })}
          />
          <div className="flex flex-col gap-2">
            <PasswordField
              id="passwordConfirm"
              name="passwordConfirm"
              label="비밀번호 확인"
              hint="위에 입력한 비밀번호를 한 번 더 입력해 주세요. 다음 단계에서 이 비밀번호가 다시 필요해요."
              shown={shown}
              onToggle={() => setShown((v) => !v)}
              toggleName="비밀번호 확인"
              controls="password passwordConfirm"
              autoComplete="new-password"
              required
              maxLength={200}
              invalid={note === 'mismatch' || note === 'empty'}
              describedBy={note === 'mismatch' || note === 'empty' ? 'passwordConfirm-note' : undefined}
              ref={confirmRef}
              onChange={() => warned && compare({ emptyIsError: false })}
              onBlur={() => compare({ emptyIsError: false })}
            />
            <div aria-live="polite">
              {(note === 'mismatch' || note === 'empty') && (
                <p id="passwordConfirm-note" className="flex gap-2 text-base leading-[1.6] text-n-9 break-keep">
                  <AlertIcon className="mt-0.5 size-5 shrink-0 text-danger" />
                  {note === 'empty' ? '비밀번호를 한 번 더 입력해 주세요' : MSG_PASSWORD_MISMATCH_CLIENT}
                </p>
              )}
              {note === 'match' && (
                <p className="flex gap-2 text-base leading-[1.6] text-n-8">
                  <CheckIcon className="mt-0.5 size-5 shrink-0 text-success" />
                  비밀번호가 같아요
                </p>
              )}
            </div>
          </div>
        </>
      ) : (
        <Field label="비밀번호" name="password" type="password" placeholder="비밀번호를 입력하세요" required />
      )}
      {mode === 'signup' && <Field label="연락처" name="phone" placeholder="010-0000-0000" />}
      {mode === 'signup' && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[12.5px] text-n-7">
            <input type="checkbox" name="agreeTerms" required className="h-4 w-4" />
            <Link href="/legal/terms" target="_blank" className="underline">
              이용약관
            </Link>
            에 동의합니다 (필수)
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-n-7">
            <input type="checkbox" name="agreePrivacy" required className="h-4 w-4" />
            <Link href="/legal/privacy" target="_blank" className="underline">
              개인정보 수집·이용
            </Link>
            에 동의합니다 (필수)
          </label>
        </div>
      )}
      {mode === 'signin' && redirectTo && (
        <input type="hidden" name="redirect" value={redirectTo} />
      )}

      {state && 'error' in state &&
        (mode === 'signup' ? (
          <p className="flex gap-3 rounded-md border-l-4 border-danger bg-n-1 px-4 py-3 text-base leading-[1.6] text-n-9 break-keep">
            <AlertIcon className="mt-0.5 size-6 shrink-0 text-danger" />
            {state.error}
          </p>
        ) : (
          <p className="text-[12.5px] text-danger">{state.error}</p>
        ))}

      <button
        type="submit"
        disabled={pending}
        className="h-[46px] rounded-pill bg-pink text-[14px] font-semibold text-white disabled:opacity-60"
      >
        {pending ? '처리 중...' : mode === 'signup' ? '가입하기' : '로그인'}
      </button>

      <p className="text-center text-[12px] text-n-6">
        {mode === 'signup' ? (
          <>
            이미 계정이 있으신가요?{' '}
            <Link href="/sign-in" className="font-medium text-pink">
              로그인
            </Link>
          </>
        ) : (
          <>
            계정이 없으신가요?{' '}
            <Link href="/sign-up" className="font-medium text-pink">
              회원가입
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  required,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px]">
      <span className="text-n-7">
        {label}
        {required && ' *'}
      </span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        defaultValue={defaultValue}
        className="h-11 rounded-md border border-n-3 bg-n-1 px-3 text-[13px] text-n-9 outline-none placeholder:text-n-5 focus:border-pink"
      />
    </label>
  );
}
