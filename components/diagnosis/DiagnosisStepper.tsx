'use client';

import { useEffect, useRef, useState } from 'react';
import { submitDiagnosis } from '@/app/actions/diagnosis';
import { DIAGNOSIS_QUESTIONS } from '@/data/diagnosis/questions';
import { DIAGNOSIS_AREAS, DIAGNOSIS_SCALE_LABELS, DIAGNOSIS_VERSION } from '@/data/diagnosis/config';

// 30문항 스테퍼(F-DIAG-3/4/5). ConfirmDialog/FormDialog와 동일한 이유로 예외적으로
// 클라이언트 컴포넌트다 — 페이지 이동·임시저장이라는 클라이언트 상태가 꼭 필요한 화면
// (flows.md 1.3절 "구현 방식 메모" 참고). 모든 입력을 하나의 <form> 안에 계속 마운트해두고
// (`hidden`으로 페이지만 전환) 마지막 페이지에서만 실제 제출이 일어나게 한다 — hidden
// 엘리먼트도 FormData에는 포함되므로 페이지별로 별도 폼을 둘 필요가 없다.

const DRAFT_KEY = 'bara_selfcheck_draft_v1';
const TOTAL_PAGES = 1 + DIAGNOSIS_AREAS.length; // 기본정보 1 + 영역 6

type DraftShape = {
  version: string;
  savedAt: number;
  currentPage: number;
  fields: Record<string, string>;
};

export default function DiagnosisStepper({
  defaultName,
  defaultPhone,
  defaultEmail,
}: {
  defaultName?: string;
  defaultPhone?: string;
  defaultEmail?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [page, setPage] = useState(0);
  const [errorFields, setErrorFields] = useState<Set<string>>(new Set());
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const pendingDraftRef = useRef<DraftShape | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  // 진행률 바("n/30문항")용 — uncontrolled input이라 값 자체는 React state로 미러링하지
  // 않지만, "몇 개 응답했는지" 개수만 onChange 시점에 다시 세어 state로 반영한다(렌더 중
  // ref를 직접 읽지 않기 위해 — react-hooks/refs 규칙).
  const [answeredCount, setAnsweredCount] = useState(0);

  // 마운트 시 저장된 draft가 있으면 복원 여부를 묻는다(F-DIAG-5).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as DraftShape;
      const withinOneDay = Date.now() - draft.savedAt < 24 * 60 * 60 * 1000;
      if (draft.version === DIAGNOSIS_VERSION && withinOneDay) {
        pendingDraftRef.current = draft;
        // localStorage(외부 시스템)를 마운트 시 1회 읽어 그 결과로 다이얼로그 표시 여부를
        // 정하는 것뿐이라 실제로 계단식 렌더를 유발하지 않는다 — 렌더 중 계산 불가능한
        // 진짜 외부 상태 동기화 사례(React 공식 문서의 useEffect 권장 용례).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShowRestoreDialog(true);
      } else {
        window.localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // localStorage 접근 불가 — 그냥 빈 폼으로 시작.
    }
  }, []);

  function countAnswered(form: HTMLFormElement): number {
    let count = 0;
    for (const q of DIAGNOSIS_QUESTIONS) {
      const el = form.elements.namedItem(q.code);
      if (el instanceof RadioNodeList && el.value) count++;
    }
    return count;
  }

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
      } else if (el instanceof HTMLInputElement) {
        if (el.type === 'checkbox') el.checked = value === 'on';
        else el.value = value;
      }
    }
    setAnsweredCount(countAnswered(form));
    setPage(draft.currentPage);
  }

  // pageOverride: goNext()가 "다음 페이지로 넘어가는 시점"의 페이지 번호를 명시적으로 넘길 때
  // 쓴다 — state의 page는 setPage가 비동기라 이 함수 안에서는 아직 이전 값이므로, 그냥 클로저의
  // page를 저장하면 draft의 currentPage가 실제 이동한 페이지보다 항상 1 뒤처졌다(qa-reviewer 지적).
  function saveDraft(pageOverride?: number) {
    const form = formRef.current;
    if (!form) return;
    setAnsweredCount(countAnswered(form));

    try {
      const data = new FormData(form);
      const fields: Record<string, string> = {};
      for (const [key, value] of data.entries()) {
        if (typeof value === 'string') fields[key] = value;
      }
      const draft: DraftShape = { version: DIAGNOSIS_VERSION, savedAt: Date.now(), currentPage: pageOverride ?? page, fields };
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // 저장 실패(프라이빗 브라우징 등)는 조용히 무시 — 스테퍼 자체는 계속 동작해야 한다.
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
    setErrorFields(missing);
    if (missing.size > 0) {
      const firstMissing = document.querySelector(`[data-field="${[...missing][0]}"]`);
      firstMissing?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    return true;
  }

  function goNext() {
    if (!validatePage(page)) return;
    const nextPage = Math.min(page + 1, TOTAL_PAGES - 1);
    saveDraft(nextPage);
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goPrev() {
    setPage((p) => Math.max(p - 1, 0));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validatePage(page)) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const data = new FormData(e.currentTarget);
      await submitDiagnosis(data);
      // submitDiagnosis는 성공 시 redirect()를 던지므로(Next.js가 예외로 구현) 여기 도달하면
      // 사실상 성공 경로다. 실패 시에도 redirect()로 /selfcheck/start?error=...로 돌아가
      // 이 컴포넌트 자체가 언마운트된다 — catch에서는 진짜 네트워크 예외만 다룬다.
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
    } catch (err) {
      // next/navigation의 redirect()는 내부적으로 특수 에러를 던져 위 try가 여기로 오지
      // 않는 게 정상 경로다. 진짜 네트워크 실패 등만 이 경로로 온다.
      if (err && typeof err === 'object' && 'digest' in err && String((err as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT')) {
        throw err;
      }
      setSubmitError(true);
      setSubmitting(false);
    }
  }

  const scaleLabelById: Record<number, string> = Object.fromEntries(DIAGNOSIS_SCALE_LABELS.map((s) => [s.score, s.label]));

  return (
    <div className="mx-auto flex max-w-[520px] flex-col gap-5 px-5 py-8">
      {showRestoreDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-n-9/40 p-5">
          <div className="flex w-full max-w-[320px] flex-col gap-4 rounded-lg bg-n-0 p-5 shadow-lg">
            <h2 className="text-[15px] font-semibold text-n-9">작성하던 진단이 있어요</h2>
            <p className="text-[12.5px] text-n-6">이어서 진행할까요?</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  try {
                    window.localStorage.removeItem(DRAFT_KEY);
                  } catch {
                    // ignore
                  }
                  setShowRestoreDialog(false);
                }}
                className="h-[38px] flex-1 rounded-pill border border-n-3 text-[13px] font-medium text-n-7"
              >
                새로 시작하기
              </button>
              <button
                type="button"
                onClick={() => {
                  if (pendingDraftRef.current) applyDraft(pendingDraftRef.current);
                  setShowRestoreDialog(false);
                }}
                className="h-[38px] flex-1 rounded-pill bg-pink text-[13px] font-semibold text-white"
              >
                이어서 하기
              </button>
            </div>
          </div>
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} onChange={() => saveDraft()} className="flex flex-col gap-5">
        {/* ===== 1페이지: 기본정보 ===== */}
        <div hidden={page !== 0} className="flex flex-col gap-4">
          <p className="text-[12px] font-semibold text-pink">1/{TOTAL_PAGES} · 기본정보</p>
          <p className="text-[13px] text-n-6">진단을 위해 몇 가지 정보가 필요해요</p>

          <TextField name="name" label="이름 *" placeholder="이름을 입력해주세요" defaultValue={defaultName} hasError={errorFields.has('name')} />
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
            <p className="-mt-2 text-[11px] text-danger">휴대전화 또는 이메일 중 최소 1개는 입력해주세요</p>
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
                  className="cursor-pointer rounded-pill border border-n-3 px-3.5 py-2 text-[12.5px] text-n-7 has-[:checked]:border-pink has-[:checked]:bg-pink/10 has-[:checked]:text-pink"
                >
                  <input type="radio" name="learningExperience" value={opt.value} className="sr-only" />
                  {opt.label}
                </label>
              ))}
            </div>
            {errorFields.has('learningExperience') && <p className="text-[11px] text-danger">지금까지의 학습 경험을 선택해주세요</p>}
          </div>

          <TextField name="certificateLevel" label="보유 자격 수준 (선택)" placeholder="예: 도형기질활용지도자 2급" />

          {/* 수집 항목·목적·보유기간·거부권을 체크박스 클릭 전에 요약 고지한다(PIPA 제22조,
              privacy-security-officer M-6 지적 — 링크만 걸어두면 실제로 읽지 않고 넘어가기 쉽다). */}
          <div className="flex flex-col gap-1 rounded-md bg-n-2 p-3 text-[11.5px] text-n-6">
            <p className="font-semibold text-n-7">진단을 위해 아래 정보를 수집·이용해요</p>
            <p>· 항목: 이름, 휴대전화 또는 이메일, 학습 경험, 30문항 응답</p>
            <p>· 목적: 자가진단 채점·결과 제공, 추천 과정 안내, 회원 전환 시 결과 연결</p>
            <p>· 보유기간: 회원에게 연결되지 않으면 접수 후 90일 뒤 이름·연락처만 자동 파기</p>
            <p>· 동의를 거부할 수 있으며, 그 경우 진단 서비스 이용이 어려울 수 있어요</p>
          </div>

          <label className="flex items-start gap-2 text-[12px] text-n-7">
            <input type="checkbox" name="consentPrivacy" className="mt-0.5 h-4 w-4 shrink-0" data-field="consentPrivacy" />
            <span>
              <a href="/legal/privacy" target="_blank" className="underline">
                개인정보 수집·이용
              </a>
              에 동의합니다 (필수)
            </span>
          </label>
          {errorFields.has('consentPrivacy') && <p className="text-[11px] text-danger">개인정보 수집·이용에 동의해야 진단을 시작할 수 있어요</p>}

          {/* 회원가입과 달리 이 화면은 로그인 없이 개인정보를 직접 수집하는 첫 경로라 별도의
              연령 확인이 없었다 — 만 14세 미만은 법정대리인 동의가 필요하다(PIPA 제22조의2,
              privacy-security-officer M-5 지적). RPC(submit_diagnosis)도 서버에서 다시 확인한다. */}
          <label className="flex items-start gap-2 text-[12px] text-n-7">
            <input type="checkbox" name="ageConfirmed" className="mt-0.5 h-4 w-4 shrink-0" data-field="ageConfirmed" />
            <span>만 14세 이상입니다 (필수)</span>
          </label>
          {errorFields.has('ageConfirmed') && <p className="text-[11px] text-danger">만 14세 미만은 법정대리인 동의가 필요해 온라인으로 접수할 수 없어요</p>}
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
              <div className="rounded-md border border-danger bg-danger/10 px-3 py-2.5 text-[12.5px] font-medium text-danger">
                5문항 중 {errorFields.size}문항에 아직 답하지 않았어요. 표시된 문항에 답해주세요.
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
                      <span className="mr-1.5 text-n-5">{s.score}.</span>
                      {scaleLabelById[s.score]}
                    </span>
                  </label>
                ))}
                {errorFields.has(q.code) && <p className="text-[11px] text-danger">이 문항에 답해주세요</p>}
              </fieldset>
            ))}
          </div>
        ))}

        {submitError && (
          <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
            제출에 실패했어요. 잠시 후 다시 시도해주세요.
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
            <button type="button" onClick={goNext} className="h-11 flex-1 rounded-pill bg-pink text-[13px] font-semibold text-white">
              다음
            </button>
          ) : (
            <button
              type="submit"
              disabled={submitting}
              className="h-11 flex-1 rounded-pill bg-pink text-[13px] font-semibold text-white disabled:opacity-60"
            >
              {submitting ? '제출 중...' : '제출하고 결과 보기'}
            </button>
          )}
        </div>
      </form>
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
      {hasError && <span className="text-[11px] text-danger">필수 항목이에요</span>}
    </label>
  );
}
