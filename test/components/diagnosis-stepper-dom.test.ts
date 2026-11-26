// @vitest-environment jsdom
// DOM 수준 검사: 초안 복원(applyDraft)이 동의 체크박스·숨은 칸을 되살리지 않고, 제출이 1페이지를 다시 검증하는지.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { DRAFT_KEY } from '@/components/diagnosis/selfcheck-draft';
import { DIAGNOSIS_VERSION } from '@/data/diagnosis/config';
import { DRAFT_RESTORE_COPY, PRIVACY_CONSENT_COPY, SENSITIVE_REFUSAL_COPY } from '@/data/diagnosis/consent-copy';

const submit = vi.fn<(fd: FormData) => Promise<void>>(async () => {});
vi.mock('@/app/actions/diagnosis', () => ({ submitDiagnosis: (fd: FormData) => submit(fd) }));
import DiagnosisStepper from '@/components/diagnosis/DiagnosisStepper';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  submit.mockClear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const form = () => container.querySelector('form') as HTMLFormElement;
const input = (name: string) => form().querySelector(`[name="${name}"]`) as HTMLInputElement;
const button = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

async function mountWithDraft(fields: Record<string, string>) {
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: DIAGNOSIS_VERSION, savedAt: Date.now(), fields }));
  await act(async () => {
    root.render(createElement(DiagnosisStepper, {}));
  });
}

test('초안 복원은 이름·응답만 되살리고 동의 체크박스·숨은 칸은 건드리지 않는다', async () => {
  // 저장본에 동의 값과 숨은 칸 값이 들어 있어도(옛 코드·조작) 복원되지 않아야 한다.
  await mountWithDraft({
    name: '홍길동',
    email: 'a@b.kr',
    consentPrivacy: 'on',
    consentSensitive: 'on',
    ageConfirmed: 'on',
    consentSensitiveVersion: 'sc-v0',
    A1: '3',
  });
  expect(container.textContent).toContain(DRAFT_RESTORE_COPY.title);
  const hiddenBefore = input('consentSensitiveVersion').value;
  expect(hiddenBefore).toBe('sc-v1');

  await act(async () => {
    button(DRAFT_RESTORE_COPY.continue).click();
  });

  expect(input('name').value).toBe('홍길동');
  expect((form().querySelector('input[name="A1"]:checked') as HTMLInputElement | null)?.value).toBe('3');
  for (const name of ['consentPrivacy', 'consentSensitive', 'ageConfirmed']) {
    expect(input(name).type).toBe('checkbox');
    expect(input(name).checked, name).toBe(false);
  }
  expect(input('consentSensitiveVersion').value).toBe('sc-v1');
  expect(input('consentSensitiveVersion').type).toBe('hidden');
});

test('제출은 1페이지를 다시 검증한다: 동의가 비어 있으면 서버 액션을 부르지 않고 오류를 보인다', async () => {
  await mountWithDraft({ name: '홍길동', email: 'a@b.kr', learningExperience: 'none' });
  await act(async () => {
    button(DRAFT_RESTORE_COPY.continue).click();
  });
  await act(async () => {
    form().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(submit).not.toHaveBeenCalled();
  expect(container.textContent).toContain(PRIVACY_CONSENT_COPY.error);
  expect(container.textContent).toContain(SENSITIVE_REFUSAL_COPY.error);
});
