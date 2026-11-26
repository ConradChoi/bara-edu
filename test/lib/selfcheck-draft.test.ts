import { expect, test } from 'vitest';
import { buildDraft, CONSENT_FIELDS, DRAFT_KEY, DRAFT_TTL_MS, LEGACY_DRAFT_KEYS, parseDraft, RESTORE_PAGE } from '@/components/diagnosis/selfcheck-draft';

const V = 'shape-v1';
const NOW = 1_800_000_000_000;
const formEntries = (): [string, string][] => [
  ['name', '홍길동'],
  ['email', 'a@b.kr'],
  ['learningExperience', 'none'],
  ['consentPrivacy', 'on'],
  ['consentSensitive', 'on'],
  ['consentSensitiveVersion', 'sc-v1'],
  ['ageConfirmed', 'on'],
  ['A1', '3'],
];

test('키는 v2, 옛 v1 키는 지울 대상', () => {
  expect(DRAFT_KEY).toBe('bara_selfcheck_draft_v2');
  expect(LEGACY_DRAFT_KEYS).toContain('bara_selfcheck_draft_v1');
});

test('저장할 때 동의 칸 4개는 빠지고 입력·응답은 남는다', () => {
  const d = buildDraft(formEntries(), V, NOW);
  for (const f of CONSENT_FIELDS) expect(d.fields).not.toHaveProperty(f);
  expect(d.fields).toEqual({ name: '홍길동', email: 'a@b.kr', learningExperience: 'none', A1: '3' });
});

test('저장된 초안에 동의 값이 들어 있어도 복원하지 않는다(옛 코드·조작 대비)', () => {
  const raw = JSON.stringify({ version: V, savedAt: NOW - 1000, currentPage: 4, fields: Object.fromEntries(formEntries()) });
  const d = parseDraft(raw, V, NOW);
  expect(d).not.toBeNull();
  for (const f of CONSENT_FIELDS) expect(d!.fields).not.toHaveProperty(f);
  expect(d!.fields.A1).toBe('3');
  // 저장 당시 4페이지였어도 1페이지(동의)부터 다시 시작한다.
  expect(RESTORE_PAGE).toBe(0);
  expect(d).not.toHaveProperty('currentPage');
});

test('버전 불일치·24시간 경과·깨진 값은 복원하지 않는다', () => {
  const ok = JSON.stringify({ version: V, savedAt: NOW, fields: {} });
  expect(parseDraft(ok, V, NOW)).not.toBeNull();
  expect(parseDraft(ok, 'shape-v2', NOW)).toBeNull();
  expect(parseDraft(ok, V, NOW + DRAFT_TTL_MS)).toBeNull();
  expect(parseDraft('{', V, NOW)).toBeNull();
  expect(parseDraft('null', V, NOW)).toBeNull();
  expect(parseDraft(null, V, NOW)).toBeNull();
  expect(parseDraft(JSON.stringify({ version: V, savedAt: NOW }), V, NOW)).toBeNull();
});

test('제출 성공 redirect(결과 화면)만 초안 삭제 대상, 실패 redirect·다른 오류는 아님', async () => {
  const { isSubmitSuccessRedirect } = await import('@/components/diagnosis/selfcheck-draft');
  const r = (url: string) => Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;push;${url};303;` });
  expect(isSubmitSuccessRedirect(r('/selfcheck/result/3f1c2a9e-0000-4000-8000-000000000000'))).toBe(true);
  expect(isSubmitSuccessRedirect(r('/selfcheck/start?error=consent-outdated'))).toBe(false);
  expect(isSubmitSuccessRedirect(r('/selfcheck/start?error=submit-failed'))).toBe(false);
  expect(isSubmitSuccessRedirect(r('/selfcheck/result/x?claimDenied=1'))).toBe(false);
  expect(isSubmitSuccessRedirect(new Error('network'))).toBe(false);
  expect(isSubmitSuccessRedirect(null)).toBe(false);
});
