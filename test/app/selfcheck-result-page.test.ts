import { expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fill, RESULT_COPY } from '@/data/diagnosis/consent-copy';
import { siteConfig } from '@/data/site-config';

let summary: unknown = null;
let user: { id: string } | null = null;
let detail: unknown = null;
let myResults: () => Promise<unknown[]> = async () => [];
vi.mock('@/lib/supabase/diagnosis-queries', () => ({
  getDiagnosisSummary: async () => summary,
  getDiagnosisDetail: async () => detail,
  getMyDiagnosisResults: () => myResults(),
}));
vi.mock('@/lib/db/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }) }));
vi.mock('@/app/actions/diagnosis', () => ({ claimDiagnosis: async () => {}, submitDiagnosisLead: async () => {}, deleteMyDiagnosisResult: async () => {} }));
let recentCookie: string | undefined;
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (n === 'bara_selfcheck_recent_token' && recentCookie ? { value: recentCookie } : undefined) }) }));

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

const baseSummary = {
  recommendedTier: 'level1', totalScore: 60, ctaLabel: null, ctaDescription: null, courseId: null, courseSlug: null, courseTitle: null,
  hasOwner: false, isOwnedByCaller: false,
};
const ownDetail = {
  respondentName: '홍길동', recommendedTier: 'level1', totalScore: 60, scoreTheory: 1, scoreReading: 2, scoreAnalysis: 3, scoreCounseling: 4,
  scoreCaseRecord: 5, scoreTeaching: 6, strengthAreas: [], improvementAreas: [], createdAt: '2026-12-03T05:02:00.000Z',
};

test('연결 확인 상자(로그인 + 미연결 + 제출 브라우저 아님)에 SC-RES-CLAIM-WARN, 지우기 버튼 없음', async () => {
  user = { id: 'u1' };
  detail = null;
  summary = baseSummary;
  const html = await render();
  expect(html).toContain('이 진단 결과가 본인 것이 맞나요?');
  expect(html).toContain(RESULT_COPY.claimWarn);
  expect(html).not.toContain(RESULT_COPY.deleteBtn);
});

test('소유 회원 상세: 맨 아래 [이 진단 기록 지우기], 같은 대화상자, 문의 있으면 함께 지우기(기본 체크)', async () => {
  user = { id: 'u1' };
  summary = { ...baseSummary, hasOwner: true, isOwnedByCaller: true };
  detail = ownDetail;
  myResults = async () => [{ accessToken: 'other', hasLead: false }, { accessToken: 't', hasLead: true }];
  const html = await render();
  expect(html).toContain(`>${RESULT_COPY.deleteBtn}</button>`);
  expect(html.lastIndexOf(RESULT_COPY.deleteBtn)).toBeGreaterThan(html.indexOf('6영역 점수'));
  expect(html).not.toContain(RESULT_COPY.claimWarn);
  const dialog = html.split('<dialog')[1];
  expect(dialog).toContain('이 진단 기록을 지울까요?');
  expect(dialog).toContain('그대로 두기');
  expect(dialog).toMatch(/<input type="checkbox"[^>]*name="deleteLeads"[^>]*checked=""/);

  myResults = async () => [{ accessToken: 't', hasLead: false }];
  expect((await render()).split('<dialog')[1]).not.toContain('type="checkbox"');
});

test('내 결과 목록을 못 읽거나 목록에 없으면 지우기 버튼을 숨긴다', async () => {
  user = { id: 'u1' };
  summary = { ...baseSummary, hasOwner: true, isOwnedByCaller: true };
  detail = ownDetail;
  myResults = async () => {
    throw new Error('down');
  };
  expect(await render()).not.toContain(RESULT_COPY.deleteBtn);
  myResults = async () => [];
  expect(await render()).not.toContain(RESULT_COPY.deleteBtn);
});

test('비로그인 요약 화면에는 지우기 버튼이 없다', async () => {
  user = null;
  detail = null;
  summary = baseSummary;
  expect(await render()).not.toContain(RESULT_COPY.deleteBtn);
});

test('비로그인 열람자에게 지우는 방법(SC-RES-GUEST-DELETE-HELP)이 전화·이메일과 함께 보이고, 소유 회원에게는 없다', async () => {
  summary = { ...baseSummary };
  user = null;
  detail = null;
  const guest = await render();
  expect(guest).toContain(fill(RESULT_COPY.guestDeleteHelp, { phone: siteConfig.phone, email: siteConfig.email }));
  user = { id: 'u1' };
  summary = { ...baseSummary, hasOwner: true, isOwnedByCaller: true };
  detail = ownDetail;
  const owner = await render();
  expect(owner).not.toContain(RESULT_COPY.guestDeleteHelp.slice(0, 12));
  user = null;
  detail = null;
});

test('쿠키 토큰이 URL 토큰과 같으면 제출 브라우저로 보고 연결 확인 상자 없이 자동 귀속', async () => {
  user = { id: 'u1' };
  detail = null;
  summary = baseSummary;
  recentCookie = 't';
  try {
    const html = await render();
    expect(html).not.toContain('이 진단 결과가 본인 것이 맞나요?');
    expect(html).not.toContain(RESULT_COPY.claimWarn);
    // AutoClaim(숨은 폼 자동 제출)이 실제로 렌더된다
    expect(html).toContain('결과를 연결하는 중이에요');
  } finally {
    recentCookie = undefined;
  }
});
