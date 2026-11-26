import { expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RESULT_COPY } from '@/data/diagnosis/consent-copy';

let summary: unknown = null;
vi.mock('@/lib/supabase/diagnosis-queries', () => ({ getDiagnosisSummary: async () => summary, getDiagnosisDetail: async () => null }));
vi.mock('@/lib/db/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }) }));
vi.mock('@/app/actions/diagnosis', () => ({ claimDiagnosis: async () => {}, submitDiagnosisLead: async () => {} }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import Page from '@/app/(public)/selfcheck/result/[token]/page';

const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ token: 't' }), searchParams: Promise.resolve({}) }));

test('결과 없음(삭제·파기 포함): SC-RES-NOTFOUND-* 문구, 삭제 여부는 말하지 않는다', async () => {
  summary = null;
  const html = await render();
  expect(html).toContain(RESULT_COPY.notFoundTitle);
  expect(html).toContain(RESULT_COPY.notFoundDesc);
  expect(html).toContain(RESULT_COPY.notFoundBtn);
  expect(html).not.toContain(RESULT_COPY.linkNotice);
});

test('요약이 보이는 화면에는 결과 링크 공개 범위 안내(print-hide)', async () => {
  summary = {
    recommendedTier: 'level1', totalScore: 60, ctaLabel: null, ctaDescription: null, courseId: null, courseSlug: null, courseTitle: null,
    hasOwner: false, isOwnedByCaller: false,
  };
  const html = await render();
  expect(html).toContain(RESULT_COPY.linkNotice);
  expect(html).toMatch(/class="print-hide[^"]*"[^>]*>.*결과 링크/);
});
