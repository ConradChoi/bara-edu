'use client';

import { useEffect, useRef, useState, useTransition, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { updateMemberProfile } from '@/app/actions/admin-members';
import Notice from '@/components/admin/Notice';
import StatusBadge from '@/components/admin/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  applyOutcome,
  cancelEdit,
  changedFields,
  FAIL_TEXT,
  FORBIDDEN_TEXT,
  initialState,
  isDirty,
  LOCKED_TEXT,
  LOG_FAILED_TEXT,
  MAIL_UNSURE,
  MSG,
  normalizeName,
  normalizePhone,
  REASON_LABEL,
  REASONS,
  savedMessage,
  startEdit,
  STATE_CHANGED_TEXT,
  UNCHANGED_SERVER,
  validateMemo,
  validateName,
  validatePhone,
  firstErrorField,
  lockedWhy,
  validateForm,
  type EditorState,
  type EditReason,
  type FieldKey,
  type FocusTarget,
  type FormState,
  type SaveOutcome,
} from '@/lib/admin-profile-edit';
import { PROFILE_EDITS_RELOAD } from '@/components/admin/ProfileEditHistory';

// 보기 → 편집 → 확인 → 결과. 정의서 docs/02-design/features/bara-edu-lms.admin-profile-edit.md '디자인 스펙' D1~D9.

export type MemberProfileView = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string;
  role: string;
  emailConfirmed: boolean | null;
  withdrawnAtLabel: string | null;
};

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo';
const BTN = `inline-flex min-h-12 w-full items-center justify-center rounded-pill px-5 text-[15px] sm:w-auto ${FOCUS}`;
const BTN_PRIMARY = `${BTN} bg-indigo font-semibold text-white hover:bg-arc-1`;
const BTN_SECONDARY = `${BTN} border border-n-3 bg-n-0 font-medium text-n-8 hover:bg-n-1`;
const BTN_DISABLED = `${BTN} cursor-not-allowed border border-n-3 bg-n-2 font-medium text-n-6`;
const INPUT = `h-12 w-full rounded-md border bg-n-0 px-3.5 text-[16px] text-n-9 placeholder:text-n-5 sm:text-[15px] focus:outline-none focus:border-indigo focus:ring-2 focus:ring-indigo/30`;
const LABEL = 'text-[14px] font-semibold text-n-8';
const HELP = 'text-[14px] leading-[1.6] text-n-6';

function ErrorLine({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="flex gap-1.5 text-[14px] font-medium text-n-9">
      <svg className="mt-0.5 size-4 shrink-0 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v5" />
        <path d="M12 16h.01" />
      </svg>
      {children}
    </p>
  );
}

const show = (v: string | null, empty: string) => (v === null || v === '' ? empty : v);

export default function MemberProfileEditor({
  member,
  pendingCount,
  certificateCount,
  initialStep = 'view',
}: {
  member: MemberProfileView;
  pendingCount: number;
  certificateCount: number;
  initialStep?: 'view' | 'edit' | 'confirm'; // 테스트용: 서버 렌더로 각 단계를 확인한다
}) {
  const router = useRouter();
  const [state, setState] = useState<EditorState>(() => ({ ...initialState({ name: member.name, phone: member.phone }), step: initialStep }));
  const [saving, startSaving] = useTransition();
  const savingRef = useRef(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const memoRef = useRef<HTMLInputElement>(null);
  const verifiedRef = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const confirmHeadingRef = useRef<HTMLHeadingElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const targets: Record<FocusTarget, RefObject<HTMLElement | null>> = {
    name: nameRef, phone: phoneRef, reason: reasonRef, memo: memoRef, verified: verifiedRef,
    notice: noticeRef, banner: bannerRef, confirmHeading: confirmHeadingRef, editButton: editButtonRef,
  };

  // 상태 전이가 요청한 곳으로 포커스를 옮긴다(그 상태 객체당 한 번).
  const handled = useRef<EditorState | null>(null);
  useEffect(() => {
    if (!state.focus || handled.current === state) return;
    handled.current = state;
    const el = targets[state.focus].current;
    if (el) {
      el.focus();
      if (state.focus === 'confirmHeading' || state.focus === 'banner') el.scrollIntoView({ block: 'start' });
    }
  });

  const dirty = isDirty(state);
  useEffect(() => {
    if (state.step === 'view' || !dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [state.step, dirty]);

  // 입력 중 갱신은 포커스 요청을 지운다. 화면 전이(startEdit 등)는 자기 포커스 요청을 가진다.
  const set = (fn: (s: EditorState) => EditorState) => setState((s) => ({ ...fn(s), focus: null }));
  const go = (fn: (s: EditorState) => EditorState) => setState(fn);
  const setForm = (patch: Partial<FormState>, clear?: FieldKey) =>
    set((s) => ({ ...s, form: { ...s.form, ...patch }, errors: clear ? { ...s.errors, [clear]: undefined } : s.errors }));

  const { form, baseline, errors, step, notice } = state;
  const locked = state.locked ?? lockedWhy({ status: member.status, role: member.role, emailConfirmed: member.emailConfirmed, email: member.email });
  const changed = changedFields(form, baseline);
  const nameChanged = changed.includes('name');
  const phoneChanged = changed.includes('phone');

  const blurCheck = (k: 'name' | 'phone' | 'memo') => {
    set((s) => {
      const f = s.form;
      const ch = changedFields(f, s.baseline);
      let e: string | undefined;
      if (k === 'name') e = ch.includes('name') ? validateName(f.name) : undefined;
      if (k === 'phone') e = ch.includes('phone') ? validatePhone(f.phone) : undefined;
      if (k === 'memo') e = validateMemo(f.memo, f.reason);
      return { ...s, errors: { ...s.errors, [k]: e } };
    });
  };

  const toConfirm = () => {
    const { hasChange, errors: errs } = validateForm(form, baseline);
    if (!hasChange) return;
    const first = firstErrorField(errs);
    if (first) {
      setState((s) => ({ ...s, errors: errs, focus: first }));
      return;
    }
    setState((s) => ({ ...s, step: 'confirm', errors: {}, notice: s.notice?.kind === 'stale' ? null : s.notice, focus: 'confirmHeading' }));
  };

  const save = () => {
    if (savingRef.current || form.reason === '') return;
    savingRef.current = true;
    const input = { name: form.name, phone: form.phone, expected: baseline, reason: form.reason, memo: form.memo, identityChecked: form.verified };
    startSaving(async () => {
      let outcome: SaveOutcome;
      try {
        outcome = await updateMemberProfile(member.id, input);
      } catch {
        outcome = { status: 'failed' };
      }
      savingRef.current = false;
      setState((s) => applyOutcome(s, outcome));
      if (outcome.status === 'not_found') router.refresh(); // 페이지가 notFound()로 이어진다
      if (outcome.status === 'ok' || outcome.status === 'stale') window.dispatchEvent(new Event(PROFILE_EDITS_RELOAD));
    });
  };

  const announce = saving ? '저장하는 중이에요' : step === 'confirm' ? '확인 단계예요' : step === 'edit' ? '입력 단계예요' : '';
  const email = member.email ?? '';

  // ---------------- 보기 ----------------
  if (step === 'view') {
    return (
      <div className="flex flex-col gap-3">
        <div className="sr-only" role="status" aria-live="polite">
          {announce}
        </div>
        {state.banner && (
          <div className="flex flex-col gap-2">
            <Notice tone="success" role="status" tabIndex={-1} ref={bannerRef}>
              {state.banner.kind === 'saved' ? savedMessage(state.banner.changed, state.banner.mailQueued) : UNCHANGED_SERVER}
            </Notice>
            {state.banner.kind === 'saved' && !state.banner.mailQueued && (
              <Notice tone="warning" role="status">
                {MAIL_UNSURE}
              </Notice>
            )}
          </div>
        )}
        {notice && (notice.kind === 'locked' || notice.kind === 'forbidden') && (
          <Notice tone={notice.kind === 'forbidden' ? 'danger' : 'warning'} role="alert" tabIndex={-1} ref={noticeRef}>
            {notice.kind === 'forbidden' ? FORBIDDEN_TEXT : STATE_CHANGED_TEXT}
          </Notice>
        )}
        <section aria-labelledby="member-basic-title" className="rounded-lg border border-n-3 bg-n-0 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="member-basic-title" className="text-[15px] font-semibold text-n-9">
              기본 정보
            </h2>
            {locked ? (
              <button
                type="button"
                ref={editButtonRef}
                aria-disabled="true"
                aria-describedby="edit-disabled-reason"
                onClick={(e) => e.preventDefault()}
                className={BTN_DISABLED}
              >
                이름·연락처 수정
              </button>
            ) : (
              <button type="button" ref={editButtonRef} onClick={() => go(startEdit)} className={BTN_SECONDARY}>
                이름·연락처 수정
              </button>
            )}
          </div>
          {locked && (
            <p id="edit-disabled-reason" className="mt-3 flex gap-2 text-[14px] leading-[1.6] text-n-7">
              <svg className="mt-0.5 size-4 shrink-0 text-n-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              {LOCKED_TEXT[locked]}
            </p>
          )}
          <dl className="mt-4 grid grid-cols-1 gap-3 text-[14px] sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-n-6">이메일</dt>
              <dd className="break-all text-n-9">{member.email ?? '-'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-n-6">연락처</dt>
              <dd className="break-all text-n-9">{baseline.phone ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-n-6">이메일 인증</dt>
              <dd>
                {member.emailConfirmed === null ? (
                  <span className="text-n-6">확인불가</span>
                ) : (
                  <StatusBadge tone={member.emailConfirmed ? 'success' : 'warning'}>{member.emailConfirmed ? '인증완료' : '가입 마무리 전'}</StatusBadge>
                )}
              </dd>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-n-6">주소</dt>
              <dd className="break-words text-n-9">{member.address ?? '-'}</dd>
            </div>
            {member.status === 'withdrawn' && (
              <div>
                <dt className="text-n-6">탈퇴일</dt>
                <dd className="text-n-9">{member.withdrawnAtLabel ?? '-'}</dd>
              </div>
            )}
          </dl>
        </section>
      </div>
    );
  }

  // ---------------- 편집·확인 공통 알림 ----------------
  const failNotice =
    notice && (notice.kind === 'failed' || notice.kind === 'log_failed') ? (
      <Notice tone="danger" role="alert" tabIndex={-1} ref={noticeRef}>
        {notice.kind === 'log_failed' ? LOG_FAILED_TEXT : FAIL_TEXT}
      </Notice>
    ) : null;
  const retry = notice?.kind === 'failed' || notice?.kind === 'log_failed';

  const cardCls = 'flex flex-col gap-4 rounded-lg border-2 border-indigo bg-n-0 p-[15px] sm:p-[19px]';

  // ---------------- 확인 ----------------
  if (step === 'confirm') {
    const reasonLabel = form.reason ? REASON_LABEL[form.reason] : '-';
    const newName = normalizeName(form.name);
    const newPhone = normalizePhone(form.phone);
    return (
      <section aria-busy={saving} className={cardCls}>
        <div className="sr-only" role="status" aria-live="polite">
          {announce}
        </div>
        <p className="text-[14px] text-n-6">2/2 확인</p>
        {failNotice}
        <h2 ref={confirmHeadingRef} tabIndex={-1} className="text-[18px] font-semibold text-n-9 focus:outline-none">
          아래 내용으로 바꿀까요?
        </h2>

        {nameChanged ? (
          <div className="flex flex-col gap-1">
            <p className={HELP}>바뀌는 이름을 회원에게 한 번 더 읽어 드려 확인해 주세요.</p>
            <p className="break-words text-[24px] font-bold leading-[1.3] text-n-9">{newName}님</p>
          </div>
        ) : (
          <p className="text-[18px] font-bold text-n-9">휴대전화만 바꿔요</p>
        )}

        <div className="flex flex-col gap-2">
          {nameChanged ? (
            <CompareRow label="이름" before={baseline.name} after={newName} />
          ) : (
            <p className="text-[14px] text-n-6">이름 변경 없음</p>
          )}
          {phoneChanged ? (
            <CompareRow label="휴대전화" before={show(baseline.phone, '(없음)')} after={show(newPhone, '(비움)')} clearing={newPhone === null} />
          ) : (
            <p className="text-[14px] text-n-6">휴대전화 변경 없음</p>
          )}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
          <dt className="text-n-6">고치는 이유</dt>
          <dd className="text-n-9">{reasonLabel}</dd>
          {form.memo.trim() && (
            <>
              <dt className="text-n-6">메모</dt>
              <dd className="break-words text-n-9">{form.memo.trim()}</dd>
            </>
          )}
          <dt className="text-n-6">본인 확인</dt>
          <dd className="text-n-9">가입 이메일로 마쳤어요</dd>
        </dl>

        {nameChanged && pendingCount > 0 && (
          <Notice tone="warning" role="note">
            입금 대기 중인 신청이 {pendingCount}건 있어요. 승인할 때 입금자명이 바뀐 이름과 맞는지 확인해 주세요. 회원이 이전 이름으로 입금해도 되는지도 안내해 주세요.
          </Notice>
        )}
        {nameChanged && certificateCount > 0 && (
          <Notice tone="info" role="note">
            수료 이력이 {certificateCount}건 있어요. 사이트의 수료증은 바뀐 이름으로 보여요. 종이로 드린 수료증·자격증은 이전 이름 그대로예요. 다시 발급이 필요한지 회원과 확인해 주세요.
          </Notice>
        )}
        {nameChanged && <p className="text-[14px] leading-[1.6] text-n-7">이름이 바뀌면 신청 내역, 수료 이력, 수료 관리 화면에 바뀐 이름으로 보여요.</p>}
        <p className="text-[14px] leading-[1.6] text-n-7">
          저장하면 <strong className="break-all font-semibold text-n-9">{email}</strong>로 변경 안내 메일이 가요. 바뀐 값은 메일에 적지 않아요.
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <button
            type="button"
            aria-disabled={saving}
            onClick={() => {
              if (saving) return;
              setState((s) => ({ ...s, step: 'edit', notice: null, focus: 'name' }));
            }}
            className={saving ? BTN_DISABLED : BTN_SECONDARY}
          >
            돌아가서 고치기
          </button>
          <button type="button" aria-disabled={saving} onClick={() => !saving && save()} className={saving ? BTN_DISABLED : BTN_PRIMARY}>
            {saving && <span className="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-n-5 border-t-transparent motion-reduce:animate-none" aria-hidden="true" />}
            {saving ? '저장하는 중이에요' : retry ? '다시 저장' : '저장'}
          </button>
        </div>
      </section>
    );
  }

  // ---------------- 편집 ----------------
  const errCount = FIELD_KEYS.filter((k) => errors[k]).length;
  const noChange = changed.length === 0;
  const memoLen = [...form.memo].length;
  const otherReason = form.reason === 'other';
  const staleBadge = (f: 'name' | 'phone') =>
    notice?.kind === 'stale' && notice.changedFields.includes(f) && !changed.includes(f) ? <StatusBadge tone="warning">다른 관리자가 바꿈</StatusBadge> : null;

  const cancelButton = dirty ? (
    <ConfirmDialog
      triggerLabel="취소"
      triggerClassName={BTN_SECONDARY}
      title="고친 내용이 사라져요. 취소할까요?"
      confirmLabel="취소하기"
      cancelLabel="계속 고치기"
      tone="neutral"
      size="lg"
      action={() => go(cancelEdit)}
    />
  ) : (
    <button type="button" onClick={() => go(cancelEdit)} className={BTN_SECONDARY}>
      취소
    </button>
  );

  return (
    <section aria-labelledby="member-edit-title" className={cardCls}>
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
      <p className="text-[14px] text-n-6">1/2 입력</p>
      <h2 id="member-edit-title" className="text-[15px] font-semibold text-n-9">
        이름·연락처 수정
      </h2>

      {notice?.kind === 'stale' && (
        <Notice tone="warning" role="alert" tabIndex={-1} title="다른 관리자가 먼저 고쳤어요" ref={noticeRef}>
          <p>최신 내용으로 다시 불러왔어요. 한 번 더 확인해 주세요.</p>
          <dl className="mt-1 flex flex-col gap-0.5">
            <div className="flex gap-2">
              <dt className="text-n-6">내가 입력한 이름</dt>
              <dd className="break-all font-medium text-n-9">{normalizeName(notice.mine.name) || '(비움)'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-n-6">내가 입력한 휴대전화</dt>
              <dd className="break-all font-medium text-n-9">{normalizePhone(notice.mine.phone) ?? '(비움)'}</dd>
            </div>
          </dl>
        </Notice>
      )}
      {failNotice}
      <Notice tone="info" role="note">
        <p>
          회원에게 가입 이메일 <strong className="break-all font-semibold text-n-9">{email}</strong>로 본인 확인을 마친 뒤에 고쳐 주세요.
        </p>
      </Notice>

      {errCount >= 2 && (
        <Notice tone="danger" role="alert" title={`입력을 확인해 주세요 (${errCount}곳)`}>
          <ul className="flex flex-col">
            {FIELD_KEYS.filter((k) => errors[k]).map((k) => (
              <li key={k}>
                <a href={`#pe-${k}`} className={`inline-block py-2 underline ${FOCUS}`}>
                  {FIELD_NAME[k]}: {errors[k]}
                </a>
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          toConfirm();
        }}
        className="flex flex-col gap-5"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pe-name" className={`${LABEL} flex flex-wrap items-center gap-2`}>
            이름 (필수) {staleBadge('name')}
          </label>
          <input
            id="pe-name"
            ref={nameRef}
            type="text"
            autoComplete="off"
            value={form.name}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={`pe-name-help${errors.name ? ' pe-name-error' : ''}`}
            onChange={(e) => setForm({ name: e.target.value })}
            onBlur={() => blurCheck('name')}
            className={`${INPUT} ${errors.name ? 'border-danger ring-1 ring-danger' : 'border-n-3'}`}
          />
          <p id="pe-name-help" className={HELP}>
            2자 이상 100자 이하로 입력해 주세요.
          </p>
          <ErrorLine id="pe-name-error">{errors.name}</ErrorLine>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="pe-phone" className={`${LABEL} flex flex-wrap items-center gap-2`}>
            휴대전화 (선택) {staleBadge('phone')}
          </label>
          <input
            id="pe-phone"
            ref={phoneRef}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="010-1234-5678"
            value={form.phone}
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={`pe-phone-help${errors.phone ? ' pe-phone-error' : ''}`}
            onChange={(e) => setForm({ phone: e.target.value })}
            onBlur={() => blurCheck('phone')}
            className={`${INPUT} ${errors.phone ? 'border-danger ring-1 ring-danger' : 'border-n-3'}`}
          />
          <p id="pe-phone-help" className={HELP}>
            숫자, 공백, -, +, ( )만 쓸 수 있어요. 비워 두면 휴대전화가 지워져요.
          </p>
          <ErrorLine id="pe-phone-error">{errors.phone}</ErrorLine>
        </div>

        <fieldset id="pe-reason" aria-describedby={errors.reason ? 'pe-reason-error' : undefined} className="flex min-w-0 flex-col gap-2">
          <legend className={`${LABEL} mb-2`}>고치는 이유 (필수)</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {REASONS.map((r, i) => (
              <label
                key={r}
                className="flex min-h-12 items-center gap-3 rounded-md border border-n-3 px-4 py-2 text-[15px] text-n-9 has-[:checked]:border-indigo has-[:checked]:bg-n-1"
              >
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  ref={i === 0 ? (reasonRef) : undefined}
                  checked={form.reason === r}
                  onChange={() => setForm({ reason: r as EditReason }, 'reason')}
                  className={`size-5 shrink-0 accent-indigo ${FOCUS}`}
                />
                {REASON_LABEL[r]}
              </label>
            ))}
          </div>
          <ErrorLine id="pe-reason-error">{errors.reason}</ErrorLine>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="pe-memo" className={LABEL}>
            메모 {otherReason ? '(필수)' : '(선택)'} <span className="font-normal text-n-6">기타를 고르면 꼭 적어 주세요</span>
          </label>
          <input
            id="pe-memo"
            ref={memoRef}
            type="text"
            autoComplete="off"
            value={form.memo}
            aria-required={otherReason ? true : undefined}
            aria-invalid={errors.memo ? true : undefined}
            aria-describedby={`pe-memo-help${errors.memo ? ' pe-memo-error' : ''}`}
            onChange={(e) => setForm({ memo: e.target.value })}
            onBlur={() => blurCheck('memo')}
            className={`${INPUT} ${errors.memo ? 'border-danger ring-1 ring-danger' : 'border-n-3'}`}
          />
          <div className="flex items-start justify-between gap-3">
            <p id="pe-memo-help" className={HELP}>
              이름이나 전화번호는 적지 말아 주세요. 접속 기록에 1년 동안 남아요.
            </p>
            <span className="shrink-0 text-[14px] tabular-nums text-n-6">{memoLen}/100</span>
          </div>
          <ErrorLine id="pe-memo-error">{errors.memo}</ErrorLine>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            className={`flex min-h-12 items-start gap-3 rounded-md border px-4 py-3 text-[15px] text-n-9 ${form.verified ? 'border-indigo bg-n-0' : 'border-n-3 bg-n-1'}`}
          >
            <input
              id="pe-verified"
              ref={verifiedRef}
              type="checkbox"
              checked={form.verified}
              aria-invalid={errors.verified ? true : undefined}
              aria-describedby={errors.verified ? 'pe-verified-error' : undefined}
              onChange={(e) => setForm({ verified: e.target.checked }, 'verified')}
              className={`mt-0.5 size-6 shrink-0 accent-indigo ${FOCUS}`}
            />
            회원에게 가입 이메일로 본인 확인을 마쳤어요.
          </label>
          <ErrorLine id="pe-verified-error">{errors.verified}</ErrorLine>
        </div>

        <div className="flex flex-col gap-2">
          {noChange && (
            <p id="pe-nochange" className="text-[14px] text-n-7">
              {MSG.none}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {cancelButton}
            <button
              type="submit"
              aria-disabled={noChange}
              aria-describedby={noChange ? 'pe-nochange' : undefined}
              onClick={(e) => noChange && e.preventDefault()}
              className={noChange ? BTN_DISABLED : BTN_PRIMARY}
            >
              변경 내용 확인
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

const FIELD_KEYS: readonly FieldKey[] = ['name', 'phone', 'reason', 'memo', 'verified'];
const FIELD_NAME: Record<FieldKey, string> = { name: '이름', phone: '휴대전화', reason: '고치는 이유', memo: '메모', verified: '본인 확인' };

function CompareRow({ label, before, after, clearing }: { label: string; before: string; after: string; clearing?: boolean }) {
  return (
    <div className="rounded-md border border-n-3 border-l-4 border-l-indigo bg-n-1 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold text-n-9">{label}</span>
        <StatusBadge tone="warning">{clearing ? `${label}가 지워져요` : '바뀜'}</StatusBadge>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-[14px] text-n-6">변경 전</dt>
          <dd className="break-all text-[16px] tabular-nums text-n-7">{before}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[14px] text-n-6">변경 후</dt>
          <dd className="break-all text-[18px] font-bold tabular-nums text-n-9">{after}</dd>
        </div>
      </dl>
    </div>
  );
}
