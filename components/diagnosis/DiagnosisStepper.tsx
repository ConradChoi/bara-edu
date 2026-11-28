'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { submitDiagnosis } from '@/app/actions/diagnosis';
import BoldText from '@/components/diagnosis/BoldText';
import { buildDraft, DRAFT_KEY, isSubmitSuccessRedirect, LEGACY_DRAFT_KEYS, parseDraft, RESTORE_PAGE, type DraftShape } from '@/components/diagnosis/selfcheck-draft';
import { DIAGNOSIS_QUESTIONS } from '@/data/diagnosis/questions';
import { DIAGNOSIS_AREAS, DIAGNOSIS_SCALE_LABELS, DIAGNOSIS_VERSION } from '@/data/diagnosis/config';
import { CURRENT_SENSITIVE_CONSENT_VERSION, SENSITIVE_CONSENT_VERSIONS } from '@/data/diagnosis/consent';
import {
  AGE_CONFIRM_COPY,
  DRAFT_RESTORE_COPY,
  fill,
  OUTDATED_ERROR_COPY,
  PRIVACY_CONSENT_COPY,
  SENSITIVE_REFUSAL_COPY,
  SUBMIT_ERROR_COPY,
  type SubmitErrorCode,
} from '@/data/diagnosis/consent-copy';
import { siteConfig } from '@/data/site-config';

// 30문항 스테퍼(F-DIAG-3/4/5). ConfirmDialog/FormDialog와 동일한 이유로 예외적으로
// 클라이언트 컴포넌트다 — 페이지 이동·임시저장이라는 클라이언트 상태가 꼭 필요한 화면
// (flows.md 1.3절 "구현 방식 메모" 참고). 모든 입력을 하나의 <form> 안에 계속 마운트해두고
// (`hidden`으로 페이지만 전환) 마지막 페이지에서만 실제 제출이 일어나게 한다 — hidden
// 엘리먼트도 FormData에는 포함되므로 페이지별로 별도 폼을 둘 필요가 없다.
//
// 1페이지 동의 영역(민감정보 별도 동의, bara-edu-lms.diagnosis-sensitive-consent.md 디자인 스펙 D1~D7):
//  ① 개인정보 수집·이용 상자 → ② 민감정보 처리 상자(sc-v1 원문, data/diagnosis/consent.ts) → ③ 만 14세 확인.
//  세 체크 모두 기본 미체크, "모두 동의" 없음, 초안에서 복원하지 않음(selfcheck-draft.ts). 고지 4항목은 접지 않는다.

const TOTAL_PAGES = 1 + DIAGNOSIS_AREAS.length; // 기본정보 1 + 영역 6
const SENSITIVE = SENSITIVE_CONSENT_VERSIONS[CURRENT_SENSITIVE_CONSENT_VERSION].text;
// 1페이지 오류 칸의 화면 순서(첫 오류로 포커스를 옮길 때 쓴다).
const PAGE0_ORDER = ['name', 'phone', 'email', 'learningExperience', 'consentPrivacy', 'consentSensitive', 'ageConfirmed'];

export default function DiagnosisStepper({
  defaultName,
  defaultPhone,
  defaultEmail,
  serverError,
  serverConsent,
}: {
  defaultName?: string;
  defaultPhone?: string;
  defaultEmail?: string;
  // /selfcheck/start?error= 코드와 consent-required의 대상 체크박스(API 계약 C1 reason)
  serverError?: SubmitErrorCode;
  serverConsent?: 'privacy' | 'sensitive';
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [page, setPage] = useState(0);
  // 서버가 동의 없음(consent-required)으로 돌려보냈으면 그 체크박스의 오류·거부 안내를 바로 보인다.
  const [errorFields, setErrorFields] = useState<Set<string>>(() =>
    serverError === 'consent-required' ? new Set([serverConsent === 'privacy' ? 'consentPrivacy' : 'consentSensitive']) : new Set(),
  );
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const pendingDraftRef = useRef<DraftShape | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  // 첫 오류 칸으로 스크롤·포커스. 페이지 전환(hidden 해제)이 렌더된 뒤에 옮기려고 상태로 둔다(n은 같은 칸 재요청용).
  const [focusTarget, setFocusTarget] = useState<{ name: string; n: number } | null>(null);
  // 진행률 바("n/30문항")용 — uncontrolled input이라 값 자체는 React state로 미러링하지
  // 않지만, "몇 개 응답했는지" 개수만 onChange 시점에 다시 세어 state로 반영한다(렌더 중
  // ref를 직접 읽지 않기 위해 — react-hooks/refs 규칙).
  const [answeredCount, setAnsweredCount] = useState(0);

  // 마운트 시 저장된 draft가 있으면 복원 여부를 묻는다(F-DIAG-5). 옛 키(v1)는 읽지 않고 지운다(4.2절).
  useEffect(() => {
    let draft: DraftShape | null = null;
    try {
      for (const key of LEGACY_DRAFT_KEYS) window.localStorage.removeItem(key);
      const raw = window.localStorage.getItem(DRAFT_KEY);
      draft = parseDraft(raw, DIAGNOSIS_VERSION, Date.now());
      if (raw && !draft) window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // localStorage 접근 불가 — 그냥 빈 폼으로 시작.
    }
    if (draft) {
      pendingDraftRef.current = draft;
      // localStorage(외부 시스템)를 마운트 시 1회 읽어 그 결과로 다이얼로그 표시 여부를
      // 정하는 것뿐이라 실제로 계단식 렌더를 유발하지 않는다 — 렌더 중 계산 불가능한
      // 진짜 외부 상태 동기화 사례(React 공식 문서의 useEffect 권장 용례).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowRestoreDialog(true);
      setHasDraft(true);
    } else if (serverError === 'consent-required') {
      setFocusTarget({ name: serverConsent === 'privacy' ? 'consentPrivacy' : 'consentSensitive', n: 0 });
    }
  }, [serverError, serverConsent]);

  useEffect(() => {
    if (!focusTarget) return;
    const form = formRef.current;
    const container = document.querySelector(`[data-field="${focusTarget.name}"]`);
    container?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const el = form?.elements.namedItem(focusTarget.name);
    const input = el instanceof RadioNodeList ? el[0] : el;
    if (input instanceof HTMLElement) input.focus({ preventScroll: true });
  }, [focusTarget]);

  function countAnswered(form: HTMLFormElement): number {
    let count = 0;
    for (const q of DIAGNOSIS_QUESTIONS) {
      const el = form.elements.namedItem(q.code);
      if (el instanceof RadioNodeList && el.value) count++;
    }
    return count;
  }

  // 입력값과 응답만 되살린다. 동의 칸은 parseDraft가 이미 빼 두었고, 페이지는 항상 1페이지(동의부터 다시).
  function applyDraft(draft: DraftShape) {
    const form = formRef.current;
    if (!form) return;
    for (const [name, value] of Object.entries(draft.fields)) {
      const el = form.elements.namedItem(name);
      if (!el) continue;
      if (el instanceof RadioNodeList) {
        for (const radio of Array.from(el)) {
          if (radio instanceof HTMLInputElement && radio.value === value) radio.checked = true;
        }
      } else if (el instanceof HTMLInputElement && el.type !== 'checkbox' && el.type !== 'hidden') {
        el.value = value;
      }
    }
    setAnsweredCount(countAnswered(form));
    setPage(RESTORE_PAGE);
  }

  function closeRestoreDialog() {
    setShowRestoreDialog(false);
    if (serverError === 'consent-required') {
      setFocusTarget({ name: serverConsent === 'privacy' ? 'consentPrivacy' : 'consentSensitive', n: Date.now() });
    }
  }

  function clearDraft() {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  }

  function saveDraft() {
    const form = formRef.current;
    if (!form) return;
    setAnsweredCount(countAnswered(form));

    try {
      const draft = buildDraft(new FormData(form).entries(), DIAGNOSIS_VERSION, Date.now());
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // 저장 실패(프라이빗 브라우징 등)는 조용히 무시 — 스테퍼 자체는 계속 동작해야 한다.
    }
  }

  // 동의 체크를 켜면 그 칸의 오류(와 거부 안내)를 바로 지운다(4.1절 "체크 시 오류 해제").
  function handleChange(e: React.FormEvent<HTMLFormElement>) {
    saveDraft();
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'checkbox' && t.checked && errorFields.has(t.name)) {
      setErrorFields((prev) => {
        const next = new Set(prev);
        next.delete(t.name);
        return next;
      });
    }
  }

  function fieldsForPage(pageIndex: number): { name: string; required: boolean }[] {
    if (pageIndex === 0) {
      return [
        { name: 'name', required: true },
        // 휴대전화/이메일은 개별 필수가 아니라 "둘 중 최소 1개"만 필수라 아래 목록에는
        // 넣지 않고 validatePage()에서 따로 확인한다(최소수집 원칙, 대표 결정 2026-09-14).
        { name: 'learningExperience', required: true },
        { name: 'consentPrivacy', required: true },
        { name: 'consentSensitive', required: true },
        { name: 'ageConfirmed', required: true },
      ];
    }
    const area = DIAGNOSIS_AREAS[pageIndex - 1];
    return DIAGNOSIS_QUESTIONS.filter((q) => q.area === area.code).map((q) => ({ name: q.code, required: true }));
  }

  function validatePage(pageIndex: number): boolean {
    const form = formRef.current;
    if (!form) return false;
    const data = new FormData(form);
    const missing = new Set<string>();
    for (const { name, required } of fieldsForPage(pageIndex)) {
      if (!required) continue;
      const value = data.get(name);
      if (value === null || (typeof value === 'string' && value.trim() === '')) missing.add(name);
    }
    if (pageIndex === 0) {
      const phone = (data.get('phone') as string | null)?.trim();
      const email = (data.get('email') as string | null)?.trim();
      if (!phone && !email) {
        missing.add('phone');
        missing.add('email');
      }
    }
    const ordered = pageIndex === 0 ? PAGE0_ORDER.filter((n) => missing.has(n)) : [...missing];
    setErrorFields(new Set(ordered));
    if (ordered.length > 0) {
      setFocusTarget({ name: ordered[0], n: Date.now() });
      return false;
    }
    return true;
  }

  function goNext() {
    if (!validatePage(page)) return;
    const nextPage = Math.min(page + 1, TOTAL_PAGES - 1);
    saveDraft();
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goPrev() {
    setPage((p) => Math.max(p - 1, 0));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // 뒤로 가기로 1페이지에 돌아가 동의를 풀고 다시 온 경우: 제출 시점 체크 상태로 판정해 1페이지 오류로 보낸다(11.1).
    if (!validatePage(0)) {
      setPage(0);
      return;
    }
    if (!validatePage(page)) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const data = new FormData(e.currentTarget);
      await submitDiagnosis(data);
    } catch (err) {
      // submitDiagnosis는 성공·실패 모두 redirect()로 끝나고, Next는 그 promise를 NEXT_REDIRECT 오류로 reject한다.
      // 그래서 성공 판별과 초안 삭제를 여기서 한다(예전에는 await 뒤에서 지워 실제로는 실행되지 않았다).
      // 실패 redirect(/selfcheck/start?error=...)는 초안을 남겨 다시 열 때 답을 되살린다.
      if (err && typeof err === 'object' && 'digest' in err && String((err as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT')) {
        if (isSubmitSuccessRedirect(err)) clearDraft();
        throw err;
      }
      setSubmitError(true);
      setSubmitting(false);
    }
  }

  const scaleLabelById: Record<number, string> = Object.fromEntries(DIAGNOSIS_SCALE_LABELS.map((s) => [s.score, s.label]));
  const privacyError = errorFields.has('consentPrivacy');
  const sensitiveError = errorFields.has('consentSensitive');
  const refusal = <RefusalBox />;

  return (
    <div className="mx-auto flex max-w-[520px] flex-col gap-5 px-5 py-8">
      {showRestoreDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-n-9/40 p-4">
          <div className="flex w-[min(320px,calc(100vw-32px))] flex-col gap-4 rounded-lg bg-n-0 p-5 shadow-lg">
            <h2 className="text-[18px] font-semibold text-n-9">{DRAFT_RESTORE_COPY.title}</h2>
            <div className="flex flex-col gap-2 text-[16px] text-n-8">
              <p>{DRAFT_RESTORE_COPY.body}</p>
              <p>{DRAFT_RESTORE_COPY.consent}</p>
              <p>{DRAFT_RESTORE_COPY.shared}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  try {
                    window.localStorage.removeItem(DRAFT_KEY);
                  } catch {
                    // ignore
                  }
                  pendingDraftRef.current = null;
                  setHasDraft(false);
                  closeRestoreDialog();
                }}
                className="min-h-12 flex-1 rounded-pill border border-n-3 text-[15px] font-medium text-n-8"
              >
                {DRAFT_RESTORE_COPY.startNew}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (pendingDraftRef.current) applyDraft(pendingDraftRef.current);
                  closeRestoreDialog();
                }}
                className="min-h-12 flex-1 rounded-pill bg-pink-deep text-[15px] font-semibold text-white"
              >
                {DRAFT_RESTORE_COPY.continue}
              </button>
            </div>
          </div>
        </div>
      )}

      {serverError === 'consent-outdated' ? (
        <div role="alert" className="rounded-md border border-warning bg-warning/10 px-3.5 py-3 text-[16px] font-medium text-n-9">
          {OUTDATED_ERROR_COPY.base}
          {hasDraft && ` ${OUTDATED_ERROR_COPY.answersKept}`}
        </div>
      ) : (
        serverError && (
          <div role="alert" className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger-strong">
            {SUBMIT_ERROR_COPY[serverError]}
          </div>
        )
      )}

      <form ref={formRef} onSubmit={handleSubmit} onChange={handleChange} noValidate className="flex flex-col gap-5">
        {/* ===== 1페이지: 기본정보 ===== */}
        <div hidden={page !== 0} className="flex flex-col gap-4">
          <p className="text-[12px] font-semibold text-pink-ink">1/{TOTAL_PAGES} · 기본정보</p>
          <p className="text-[13px] text-n-6">진단을 위해 몇 가지 정보가 필요해요</p>

          <TextField name="name" label="이름 *" placeholder="이름을 입력해 주세요" defaultValue={defaultName} hasError={errorFields.has('name')} />
          {/* 휴대전화/이메일은 최소 1개만 필수(최소수집 원칙) — 하나라도 입력하면 나머지 필드의
              에러 표시는 함께 사라진다(둘 다 같은 missing 집합에 들어가므로). */}
          <TextField
            name="phone"
            label="휴대전화 (연락처 1개는 필수)"
            placeholder="01012345678"
            defaultValue={defaultPhone}
            hasError={errorFields.has('phone')}
          />
          <TextField
            name="email"
            label="이메일 (연락처 1개는 필수)"
            placeholder="you@example.com"
            defaultValue={defaultEmail}
            hasError={errorFields.has('email')}
          />
          {(errorFields.has('phone') || errorFields.has('email')) && (
            <p className="-mt-2 text-[11px] text-danger-strong">휴대전화 또는 이메일 중 최소 1개는 입력해 주세요</p>
          )}

          <div data-field="learningExperience" className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-n-7">도형심리 학습 경험 *</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'none', label: '처음' },
                { value: 'past_course', label: '과거 수강' },
                { value: 'certified', label: '자격 보유' },
                { value: 'active_use', label: '현재 활용' },
              ].map((opt) => (
                <label
                  key={opt.value}
                  className="cursor-pointer rounded-pill border border-n-3 px-3.5 py-2 text-[12.5px] text-n-7 has-[:checked]:border-pink has-[:checked]:bg-pink/10 has-[:checked]:text-pink-ink"
                >
                  <input type="radio" name="learningExperience" value={opt.value} className="sr-only" />
                  {opt.label}
                </label>
              ))}
            </div>
            {errorFields.has('learningExperience') && <p className="text-[11px] text-danger-strong">지금까지의 학습 경험을 선택해 주세요</p>}
          </div>

          <TextField name="certificateLevel" label="보유 자격 수준 (선택)" placeholder="예: 도형기질활용지도자 2급" />

          {/* 동의 3개는 각자 다른 상자·체크박스·오류 문구(제22조 구분 동의). 상자 사이 24px. */}
          <div className="mt-2 flex flex-col gap-6">
            {/* ① 개인정보 수집·이용 */}
            <section role="group" aria-labelledby="consent-privacy-title" className="flex flex-col gap-3 rounded-lg border-2 border-n-3 bg-n-0 p-4">
              <div id="consent-privacy-summary" className="flex flex-col gap-2">
                <h2 id="consent-privacy-title" className="text-[16px] font-semibold text-n-9">
                  {PRIVACY_CONSENT_COPY.title}
                </h2>
                <ul className="flex flex-col gap-2 text-[16px] leading-relaxed text-n-8">
                  {PRIVACY_CONSENT_COPY.items.map((item) => (
                    <li key={item}>
                      <BoldText text={item} />
                    </li>
                  ))}
                </ul>
              </div>
              <ConsentCheck
                name="consentPrivacy"
                label={PRIVACY_CONSENT_COPY.check}
                describedBy="consent-privacy-summary"
                error={privacyError ? PRIVACY_CONSENT_COPY.error : null}
              />
              <a
                href="/legal/privacy"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={PRIVACY_CONSENT_COPY.linkSr}
                className="inline-flex min-h-12 items-center self-start text-[14px] text-n-7 underline underline-offset-2"
              >
                {PRIVACY_CONSENT_COPY.link}
              </a>
            </section>
            {privacyError && !sensitiveError && refusal}

            {/* ② 민감정보 처리(sc-v1 원문). 고지 4항목은 요약·자세히 모두 항상 보인다(접지 않음). */}
            <section
              role="group"
              aria-labelledby="consent-sensitive-title"
              className="flex flex-col gap-3 rounded-lg border-2 border-l-4 border-n-3 border-l-indigo bg-n-0 p-4"
            >
              <div id="consent-sensitive-summary" className="flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 rounded-pill bg-indigo/10 px-2 py-0.5 text-[14px] font-semibold text-indigo">필수</span>
                  <h2 id="consent-sensitive-title" className="text-[16px] font-medium text-n-9">
                    <BoldText text={SENSITIVE.title} />
                  </h2>
                </div>
                <p className="text-[16px] text-n-8">{SENSITIVE.what}</p>
                <p className="text-[16px] leading-relaxed text-n-8">
                  <BoldText text={SENSITIVE.intro} />
                </p>
                <ul className="flex flex-col gap-3 text-[16px] leading-relaxed text-n-8">
                  {SENSITIVE.items.map((item) => (
                    <li key={item.key} className="flex flex-col gap-0.5">
                      <span>
                        <BoldText text={item.summary} />
                      </span>
                      <span>
                        <BoldText text={item.detail} />
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[16px] leading-relaxed text-n-7">{SENSITIVE.linkNotice}</p>
              </div>
              <input type="hidden" name="consentSensitiveVersion" value={CURRENT_SENSITIVE_CONSENT_VERSION} />
              <ConsentCheck
                name="consentSensitive"
                label={SENSITIVE.check}
                describedBy="consent-sensitive-summary"
                error={sensitiveError ? SENSITIVE_REFUSAL_COPY.error : null}
              />
              <p className="text-[14px] text-n-7">{SENSITIVE.withdraw}</p>
            </section>
            {sensitiveError && refusal}

            {/* ③ 만 14세 이상. 회원가입과 달리 이 화면은 로그인 없이 개인정보를 직접 수집하는 첫 경로라
                별도 연령 확인이 필요하다(PIPA 제22조의2). RPC(submit_diagnosis)도 서버에서 다시 확인한다. */}
            <ConsentCheck name="ageConfirmed" label={AGE_CONFIRM_COPY.check} error={errorFields.has('ageConfirmed') ? AGE_CONFIRM_COPY.error : null} />
          </div>
        </div>

        {/* ===== 2~7페이지: 영역별 5문항 ===== */}
        {DIAGNOSIS_AREAS.map((area, areaIdx) => (
          <div key={area.code} hidden={page !== areaIdx + 1} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-semibold text-n-9">{answeredCount}/30문항 응답</span>
                <span className="text-n-6">
                  {areaIdx + 2}/{TOTAL_PAGES} · {area.name}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-n-2">
                <div
                  className="h-1.5 rounded-full bg-pink transition-all"
                  style={{ width: `${(answeredCount / DIAGNOSIS_QUESTIONS.length) * 100}%` }}
                />
              </div>
            </div>

            {errorFields.size > 0 && page === areaIdx + 1 && (
              <div className="rounded-md border border-danger bg-danger/10 px-3 py-2.5 text-[12.5px] font-medium text-danger-strong">
                5문항 중 {errorFields.size}문항에 아직 답하지 않았어요. 표시된 문항에 답해 주세요.
              </div>
            )}

            {DIAGNOSIS_QUESTIONS.filter((q) => q.area === area.code).map((q) => (
              <fieldset
                key={q.code}
                data-field={q.code}
                className={`flex flex-col gap-2 rounded-lg border p-3.5 ${errorFields.has(q.code) ? 'border-danger' : 'border-n-3'}`}
              >
                <legend className="px-0.5 text-[13px] font-medium text-n-9">{q.text}</legend>
                {DIAGNOSIS_SCALE_LABELS.map((s) => (
                  <label key={s.score} className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[12.5px] text-n-7">
                    <input type="radio" name={q.code} value={s.score} required className="h-4 w-4 shrink-0" />
                    <span>
                      <span className="mr-1.5 text-n-6">{s.score}.</span>
                      {scaleLabelById[s.score]}
                    </span>
                  </label>
                ))}
                {errorFields.has(q.code) && <p className="text-[11px] text-danger-strong">이 문항에 답해 주세요</p>}
              </fieldset>
            ))}
          </div>
        ))}

        {submitError && (
          <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger-strong">
            제출에 실패했어요. 잠시 후 다시 시도해 주세요.
          </div>
        )}

        <div className="flex gap-3">
          {page > 0 && (
            <button
              type="button"
              onClick={goPrev}
              className="h-11 flex-1 rounded-pill border border-n-3 text-[13px] font-medium text-n-7"
            >
              이전
            </button>
          )}
          {page < TOTAL_PAGES - 1 ? (
            <button type="button" onClick={goNext} className="h-11 flex-1 rounded-pill bg-pink-deep text-[13px] font-semibold text-white">
              다음
            </button>
          ) : (
            <button
              type="submit"
              disabled={submitting}
              className="h-11 flex-1 rounded-pill bg-pink-deep text-[13px] font-semibold text-white disabled:opacity-60"
            >
              {submitting ? '제출 중...' : '제출하고 결과 보기'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

// 동의 체크 행: 라벨 전체가 터치 영역(56px), 24px 체크박스. 오류는 칸 바로 아래(aria-live polite, 아이콘 + 글자).
function ConsentCheck({ name, label, describedBy, error }: { name: string; label: string; describedBy?: string; error: string | null }) {
  const errorId = `${name}-error`;
  const describedByIds = [describedBy, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div data-field={name} className="flex flex-col gap-1">
      <label className="flex min-h-[56px] cursor-pointer items-center gap-3 text-[16px] font-medium text-n-9">
        <input
          type="checkbox"
          name={name}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds}
          className={`h-6 w-6 shrink-0 accent-indigo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo ${error ? 'outline outline-2 outline-danger' : ''}`}
        />
        <span>{label}</span>
      </label>
      <div aria-live="polite">
        {error && (
          <p id={errorId} className="flex items-start gap-1.5 text-[14px] font-medium text-danger-strong">
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </p>
        )}
      </div>
    </div>
  );
}

// 동의하지 않을 때의 다른 길(D2). 오류가 아니라 대안이므로 중립 톤. 포커스는 옮기지 않는다(체크박스에 남아 바로 고칠 수 있게).
function RefusalBox() {
  const tel = `tel:${siteConfig.phone.replace(/[^0-9+]/g, '')}`;
  return (
    <div role="region" aria-label={SENSITIVE_REFUSAL_COPY.altTitle} className="-mt-3 flex flex-col gap-3 rounded-lg border border-n-3 bg-n-1 p-4">
      <p className="text-[16px] text-n-8">{SENSITIVE_REFUSAL_COPY.notSent}</p>
      <p className="text-[16px] font-semibold text-n-9">{SENSITIVE_REFUSAL_COPY.altTitle}</p>
      <Link
        href="/courses"
        className="flex min-h-12 w-full items-center justify-center rounded-pill border border-n-3 bg-n-0 px-4 text-[16px] font-medium text-n-8"
      >
        {SENSITIVE_REFUSAL_COPY.courses}
      </Link>
      <div className="flex flex-col gap-1">
        <a href={tel} className="flex min-h-12 w-full items-center justify-center rounded-pill border border-n-3 bg-n-0 px-4 text-[16px] font-medium text-n-8">
          {fill(SENSITIVE_REFUSAL_COPY.phone, { phone: siteConfig.phone })}
        </a>
        <p className="text-center text-[14px] text-n-7">{fill(SENSITIVE_REFUSAL_COPY.hours, { hours: siteConfig.supportHours })}</p>
      </div>
    </div>
  );
}

function TextField({
  name,
  label,
  placeholder,
  defaultValue,
  hasError,
}: {
  name: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
  hasError?: boolean;
}) {
  return (
    <label data-field={name} className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
      {label}
      <input
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className={`h-11 rounded-md border bg-n-1 px-3 text-[13px] text-n-9 outline-none focus:border-pink ${hasError ? 'border-danger' : 'border-n-3'}`}
      />
      {hasError && <span className="text-[11px] text-danger-strong">필수 항목이에요</span>}
    </label>
  );
}
