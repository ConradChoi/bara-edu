'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { resetAdminMfa } from '@/app/actions/admin-members';
import Notice from '@/components/admin/Notice';
import StatusBadge from '@/components/admin/StatusBadge';
import { SubmitButton } from '@/components/auth/MfaLoginForm';
import OtpCodeField, { FieldError } from '@/components/auth/OtpCodeField';
import { ADMIN_PRIMARY_BTN, ADMIN_SECONDARY_BTN, ADMIN_TEXT_LINK } from '@/components/error/styles';
import type { AdminMfaState, AdminResetReason } from '@/lib/db/mfa';
import { MFA_COPY as C, MFA_COPY_PENDING_REVIEW as P, fill } from '@/lib/mfa-copy';
import { isOtp, normalizeOtp, spokenCode } from '@/lib/mfa-format';
import type { AdminResetField, AdminResetNotice, AdminResetState } from '@/lib/mfa-setup-types';

// M5 관리자 회원 상세의 "2단계 인증" 카드(기획서 3.6, 디자인 스펙 T-9). 대상이 활성 관리자일 때만 페이지가 그린다.
// 초기화 폼은 모달이 아니라 같은 카드 안 단계다(T-0 #4). 위험 버튼도 인디고 + 경고 Notice(T-0 #7, 1.3 D10).
// 결과의 등록 코드는 한 번만 보이고 복사 버튼이 없다(전화로만 전달, 2.7.2). [확인했어요]를 누르면 DOM에서 지운다.

export type AdminMfaCardInfo = { state: AdminMfaState; stateText: string } | null;

const REASONS: readonly AdminResetReason[] = ['lost_phone', 'new_phone', 'app_deleted', 'other'];
const LABEL = 'text-[14px] font-semibold text-n-9';
const BADGE: Record<AdminMfaState, 'success' | 'warning' | 'info'> = { enrolled: 'success', not_enrolled: 'warning', reset_pending: 'info' };

const FIELD_COPY: Record<AdminResetField, string> = {
  check: C['MFA-RESET-ERR-CHECK'],
  reason: C['MFA-RESET-ERR-REASON'],
  memo: C['MFA-RESET-ERR-MEMO'],
  memo_long: C['MFA-RESET-ERR-MEMO-LONG'],
  code_format: C['MFA-RESET-ERR-CODE-FORMAT'],
  code_wrong: C['MFA-RESET-ERR-CODE-WRONG'],
  code_used: C['MFA-RESET-ERR-CODE-USED'],
};
const NOTICE_COPY: Record<AdminResetNotice, string> = {
  target_changed: C['MFA-RESET-ERR-NOTADMIN'],
  self: C['MFA-RESET-ERR-SELF'],
  log_failed: C['MFA-RESET-ERR-LOG'],
  unavailable: C['MFA-RESET-ERR-UNAVAILABLE'],
  rate_limited: C['MFA-LOGIN-ERR-RATE'],
  session: C['MFA-RESET-ERR-401'],
  need_mfa: P['APP-MFA-RESET-NEED-MFA'],
  failed: C['MFA-LOGIN-ERR-OTHER'],
};

function localErrors(f: { checked: boolean; reason: string; memo: string; code: string }): AdminResetField[] {
  const out: AdminResetField[] = [];
  const memo = f.memo.trim();
  if (!f.checked) out.push('check');
  if (!f.reason) out.push('reason');
  if (memo.length > 200) out.push('memo_long');
  else if ((f.reason === 'other' && memo.length < 5) || (memo.length > 0 && memo.length < 5)) out.push('memo');
  if (!isOtp(normalizeOtp(f.code))) out.push('code_format');
  return out;
}

export default function AdminMfaCard({ targetId, targetName, isSelf, info }: { targetId: string; targetName: string; isSelf: boolean; info: AdminMfaCardInfo }) {
  const [state, formAction, pending] = useActionState<AdminResetState, FormData>(resetAdminMfa.bind(null, targetId), undefined);
  const [open, setOpen] = useState(false);
  // [확인했어요]로 닫은 결과(같은 상태 객체를 다시 보이지 않는다)
  const [dismissed, setDismissed] = useState<AdminResetState>(undefined);
  // 체크·사유·메모는 제어 입력: 서버 오류 뒤에도 그대로 남는다(React 폼 액션의 자동 초기화를 피한다). 6자리만 비운다.
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState('');
  const [memo, setMemo] = useState('');
  const [local, setLocal] = useState<{ on: AdminResetState; fields: AdminResetField[] } | null>(null);
  const warnRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const checkRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const memoRef = useRef<HTMLTextAreaElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const done = state?.done === true && state !== dismissed ? state : null;
  const failed = state && state.done === false ? state : null;
  const fields = local && local.on === state ? local.fields : (failed?.fields ?? []);
  const has = (f: AdminResetField) => fields.includes(f);
  const codeError = fields.find((f) => f.startsWith('code_'));
  const locked = failed?.lock ?? null;

  // 열면 경고 제목으로, 결과는 결과 제목으로, 서버 알림은 알림으로, 칸 오류는 첫 칸으로(T-8·T-9.2)
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);
  useEffect(() => {
    if (!failed) return;
    if (failed.lock || failed.notice) {
      alertRef.current?.focus();
      return;
    }
    const f = failed.fields ?? [];
    if (f.includes('check')) checkRef.current?.focus();
    else if (f.includes('reason')) reasonRef.current?.focus();
    else if (f.includes('memo') || f.includes('memo_long')) memoRef.current?.focus();
    else codeRef.current?.focus();
  }, [failed]);

  // 결과(등록 코드)를 닫기 전에 창을 닫으려 하면 확인(T-9.3)
  useEffect(() => {
    if (!done) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [done]);

  const close = () => {
    setOpen(false);
    setChecked(false);
    setReason('');
    setMemo('');
    setLocal(null);
  };

  if (done) {
    return (
      <section aria-labelledby="reset-done-title" className="flex flex-col gap-4 rounded-lg border-2 border-indigo bg-n-0 p-5">
        <h2 id="reset-done-title" ref={doneRef} tabIndex={-1} className="text-[17px] font-semibold text-n-9 outline-none">
          {C['MFA-RESET-DONE-TITLE']}
        </h2>
        <Notice tone="warning" role="note">
          <p>{fill(C['MFA-RESET-DONE-1'], { 이름: targetName })}</p>
          <p className="font-semibold text-n-9">{C['MFA-RESET-DONE-2']}</p>
        </Notice>
        <div className="rounded-md border-2 border-n-5 bg-n-1 p-6 text-center">
          <p className="text-[14px] font-semibold text-n-8">{C['MFA-RESET-DONE-CODE-LABEL']}</p>
          <p aria-hidden="true" className="mt-2 font-mono text-4xl tabular-nums tracking-[0.2em] text-n-9">
            {`${done.ticket.slice(0, 4)} ${done.ticket.slice(4)}`}
          </p>
          <p className="sr-only">{fill(C['MFA-RESET-DONE-READ'], { code: spokenCode(done.ticket, 4) })}</p>
          <p className="mt-2 text-[15px] text-n-7">{fill(C['MFA-RESET-DONE-VALID'], { at: done.validUntil })}</p>
        </div>
        <p className="text-[15px] leading-[1.6] text-n-8 break-keep">{C['MFA-RESET-DONE-ONCE']}</p>
        <p className="text-[14px] leading-[1.6] text-n-7 break-keep">{fill(C['MFA-RESET-DONE-MAIL'], { 이름: targetName })}</p>
        <div>
          <button
            type="button"
            className={ADMIN_PRIMARY_BTN}
            onClick={() => {
              setDismissed(state);
              close();
            }}
          >
            {C['MFA-RESET-DONE-BTN']}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="mfa-card-title" className={`flex flex-col gap-4 rounded-lg bg-n-0 p-5 ${open ? 'border-2 border-indigo' : 'border border-n-3'}`}>
      <h2 id="mfa-card-title" className="text-[15px] font-semibold text-n-9">
        {C['MFA-RESET-CARD-TITLE']}
      </h2>
      {info === null ? (
        <Notice tone="danger" role="alert">
          <p>{C['MFA-RESET-LOADERR']}</p>
        </Notice>
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-[14px] text-n-8">
          <StatusBadge tone={BADGE[info.state]}>{C['MFA-RESET-COL-VALUES'][info.state]}</StatusBadge>
          <span>{info.stateText}</span>
        </p>
      )}

      {isSelf ? (
        <Link href="/admin/security" className={`${ADMIN_TEXT_LINK} self-start`}>
          {C['MFA-RESET-SELF']}
        </Link>
      ) : info && !open ? (
        <div>
          <button
            type="button"
            className={ADMIN_SECONDARY_BTN}
            onClick={() => {
              setOpen(true);
              requestAnimationFrame(() => warnRef.current?.focus());
            }}
          >
            {info.state === 'enrolled' ? C['MFA-RESET-BTN'] : C['MFA-RESET-BTN-TICKET']}
          </button>
        </div>
      ) : null}

      {!isSelf && info && open && (
        <>
          <Notice ref={warnRef} tabIndex={-1} tone="warning" role="note" title={fill(C['MFA-RESET-DLG-TITLE'], { 이름: targetName })}>
            <p>{fill(C['MFA-RESET-DLG-1'], { 이름: targetName })}</p>
            <p>{C['MFA-RESET-DLG-2']}</p>
            <p className="font-semibold text-n-9">{C['MFA-RESET-DLG-3']}</p>
          </Notice>
          {(locked || failed?.notice) && (
            <Notice ref={alertRef} tabIndex={-1} tone={failed?.notice === 'target_changed' ? 'warning' : 'danger'} role="alert">
              <p>
                {locked
                  ? locked.lockScope === 'daily'
                    ? C['MFA-RESET-ERR-LOCKED-DAILY']
                    : fill(C['MFA-RESET-ERR-LOCKED'], { m: locked.minutes })
                  : NOTICE_COPY[failed!.notice!]}
              </p>
              {failed?.notice === 'target_changed' && (
                <Link href={`/admin/members/${targetId}`} className={`${ADMIN_SECONDARY_BTN} mt-2 self-start`}>
                  새로고침
                </Link>
              )}
            </Notice>
          )}
          <form
            action={formAction}
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              const errs = localErrors({ checked, reason, memo, code: codeRef.current?.value ?? '' });
              setLocal(errs.length ? { on: state, fields: errs } : null);
              if (errs.length) {
                e.preventDefault();
                if (errs.includes('check')) checkRef.current?.focus();
                else if (errs.includes('reason')) reasonRef.current?.focus();
                else if (errs.includes('memo') || errs.includes('memo_long')) memoRef.current?.focus();
                else codeRef.current?.focus();
              }
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md border border-n-3 px-4 py-3 has-[:checked]:border-indigo has-[:checked]:bg-n-1">
                <input
                  ref={checkRef}
                  type="checkbox"
                  name="identityChecked"
                  required
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                  aria-invalid={has('check') || undefined}
                  aria-describedby={has('check') ? 'reset-check-error' : undefined}
                  className="mt-0.5 size-6 shrink-0 accent-indigo"
                />
                <span className="text-[15px] text-n-9 break-keep">{fill(C['MFA-RESET-CHECK'], { 이름: targetName })}</span>
              </label>
              {has('check') && (
                <FieldError id="reset-check-error" size="admin">
                  {FIELD_COPY.check}
                </FieldError>
              )}
            </div>

            <fieldset aria-describedby={has('reason') ? 'reset-reason-error' : undefined} className="flex min-w-0 flex-col gap-2">
              <legend className={`${LABEL} mb-2`}>{C['MFA-RESET-REASON-LABEL']}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {REASONS.map((r, i) => (
                  <label
                    key={r}
                    className="flex min-h-12 items-center gap-3 rounded-md border border-n-3 px-4 py-2 text-[15px] text-n-9 has-[:checked]:border-indigo has-[:checked]:bg-n-1"
                  >
                    <input
                      ref={i === 0 ? reasonRef : undefined}
                      type="radio"
                      name="reason"
                      value={r}
                      checked={reason === r}
                      onChange={() => setReason(r)}
                      className="size-5 shrink-0 accent-indigo"
                    />
                    {C['MFA-RESET-REASON'][r]}
                  </label>
                ))}
              </div>
              {has('reason') && (
                <FieldError id="reset-reason-error" size="admin">
                  {FIELD_COPY.reason}
                </FieldError>
              )}
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="reset-memo" className={LABEL}>
                {C['MFA-RESET-MEMO-LABEL']}
              </label>
              <p id="reset-memo-help" className="text-[13px] leading-[1.6] text-n-6 break-keep">
                {C['MFA-RESET-MEMO-HELP']}
              </p>
              <textarea
                ref={memoRef}
                id="reset-memo"
                name="memo"
                rows={2}
                maxLength={200}
                autoComplete="off"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                aria-required={reason === 'other' || undefined}
                aria-invalid={has('memo') || has('memo_long') || undefined}
                aria-describedby={`reset-memo-help reset-memo-count${has('memo') || has('memo_long') ? ' reset-memo-error' : ''}`}
                className="w-full rounded-md border border-n-3 bg-n-0 px-3 py-2 text-[15px] text-n-9 outline-none focus:border-indigo focus:ring-2 focus:ring-indigo aria-[invalid=true]:border-danger"
              />
              <p id="reset-memo-count" className="text-right text-[12px] tabular-nums text-n-6">
                {memo.length}/200
              </p>
              {(has('memo') || has('memo_long')) && (
                <FieldError id="reset-memo-error" size="admin">
                  {FIELD_COPY[has('memo_long') ? 'memo_long' : 'memo']}
                </FieldError>
              )}
            </div>

            <OtpCodeField
              id="reset-otp-code"
              size="admin"
              label={C['MFA-RESET-CODE-LABEL']}
              hint={C['MFA-RESET-CODE-HELP']}
              error={codeError ? FIELD_COPY[codeError] : null}
              inputRef={codeRef}
            />

            <div className="flex flex-wrap gap-3">
              {locked ? (
                <button type="button" aria-disabled="true" className={`${ADMIN_PRIMARY_BTN} cursor-not-allowed opacity-60`}>
                  {C['MFA-RESET-DLG-BTN']}
                </button>
              ) : (
                <SubmitButton pending={pending} label={C['MFA-RESET-DLG-BTN']} busy={C['MFA-RESET-DLG-BTN-BUSY']} className={ADMIN_PRIMARY_BTN} />
              )}
              <button type="button" className={ADMIN_SECONDARY_BTN} aria-disabled={pending || undefined} onClick={() => !pending && close()}>
                {C['MFA-RESET-DLG-CANCEL']}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
