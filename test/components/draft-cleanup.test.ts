// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';
import { clearSelfcheckDraft, DRAFT_KEY, DRAFT_TTL_MS, LEGACY_DRAFT_KEYS, sweepExpiredDraft } from '@/components/diagnosis/selfcheck-draft';

const V = 'shape-v1';
const NOW = 1_800_000_000_000;
const save = (savedAt: number) => window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: V, savedAt, fields: { name: '홍길동' } }));

beforeEach(() => window.localStorage.clear());

test('로그아웃: v2 초안과 옛 키를 모두 지운다', () => {
  save(NOW);
  for (const k of LEGACY_DRAFT_KEYS) window.localStorage.setItem(k, 'x');
  clearSelfcheckDraft();
  expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  for (const k of LEGACY_DRAFT_KEYS) expect(window.localStorage.getItem(k)).toBeNull();
});

test('공개 화면 마운트: 24시간 지난 초안은 지우고, 유효한 초안은 남긴다', () => {
  save(NOW - DRAFT_TTL_MS - 1);
  sweepExpiredDraft(V, NOW);
  expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  save(NOW - 1000);
  sweepExpiredDraft(V, NOW);
  expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
});
