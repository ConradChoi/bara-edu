import { beforeEach, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DELETE_RESULT_COPY, WITHDRAW_NOTE } from '@/data/diagnosis/consent-copy';

type Row = { accessToken: string; recommendedTier: string; totalScore: number; createdAt: string; hasLead: boolean };
let results: Row[] = [];
vi.mock('@/lib/supabase/diagnosis-queries', () => ({ getMyDiagnosisResults: async () => results }));
vi.mock('@/lib/supabase/classroom-queries', () => ({
  getCompletedEnrollmentsForUser: async () => [],
  getMyCertificatesWithCourse: async () => [],
  getProgressStatsForCourses: async () => ({}),
}));
vi.mock('@/lib/supabase/queries', () => ({ getMyEnrollments: async () => [] }));
const profileQuery = { select: () => profileQuery, eq: () => profileQuery, maybeSingle: async () => ({ data: { name: '회원', email: 'a@b.kr' } }) };
vi.mock('@/lib/db/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'a@b.kr' } }, error: null }) }, from: () => profileQuery }),
}));
vi.mock('@/app/actions/account', () => ({ changePassword: async () => {}, updateContactInfo: async () => {}, withdraw: async () => {} }));
vi.mock('@/app/actions/diagnosis', () => ({ deleteMyDiagnosisResult: async () => {} }));
vi.mock('@/components/mypage/WithdrawForm', () => ({ default: () => null }));
vi.mock('@/components/auth/PendingClaimRedirect', () => ({ default: () => null }));

import MyPage from '@/app/(user)/my/page';

const render = async (sp: Record<string, string>) => renderToStaticMarkup((await MyPage({ searchParams: Promise.resolve(sp) }))!);
const row = (token: string, hasLead: boolean): Row => ({ accessToken: token, recommendedTier: 'level1', totalScore: 61.4, createdAt: '2026-12-03T05:02:00.000Z', hasLead });

beforeEach(() => {
  results = [];
});

test('빈 상태: SC-MY-EMPTY + 진단 받아보기, 배너 없음', async () => {
  const html = await render({ tab: 'diagnosis' });
  expect(html).toContain(DELETE_RESULT_COPY.empty);
  expect(html).toContain(DELETE_RESULT_COPY.emptyBtn);
  expect(html).not.toContain(DELETE_RESULT_COPY.done);
});

test('마지막 기록을 지운 뒤: 완료 배너(role=status)와 빈 상태가 함께', async () => {
  const html = await render({ tab: 'diagnosis', deleted: '1' });
  expect(html).toMatch(/role="status"[^>]*>진단 기록을 지웠어요\./);
  expect(html).toContain(DELETE_RESULT_COPY.empty);
});

test('실패 배너(role=alert)에 전화번호, 목록은 유지', async () => {
  results = [row('T1', false)];
  const html = await render({ tab: 'diagnosis', deleteError: '1' });
  expect(html).toMatch(/role="alert"[^>]*>진단 기록을 지우지 못했어요\./);
  expect(html).toContain('전화 010-9025-5093');
  expect(html).toContain('/selfcheck/result/T1');
});

test('행마다 지우기 대화상자: 날짜 포함 접근성 이름, 그대로 두기, 문의 있는 행에만 "문의도 함께 지우기"(기본 체크)', async () => {
  results = [row('T1', true), row('T2', false)];
  const html = await render({ tab: 'diagnosis' });
  const dialogs = html.split('<dialog').slice(1);
  expect(dialogs).toHaveLength(2);
  expect(html.match(/aria-label="[^"]+ 진단 기록 지우기"/g)).toHaveLength(2);
  for (const d of dialogs) {
    expect(d).toContain(DELETE_RESULT_COPY.title);
    expect(d).toContain(DELETE_RESULT_COPY.body);
    expect(d).toContain(DELETE_RESULT_COPY.cancel);
    expect(d).toMatch(/aria-describedby="[^"]+"/);
  }
  expect(dialogs[0]).toContain(DELETE_RESULT_COPY.withLeads);
  expect(dialogs[0]).toContain(DELETE_RESULT_COPY.withLeadsHelp);
  expect(dialogs[0]).toMatch(/<input type="checkbox"[^>]*name="deleteLeads"[^>]*checked=""/);
  expect(dialogs[1]).not.toContain(DELETE_RESULT_COPY.withLeads);
  expect(dialogs[1]).not.toContain('type="checkbox"');
});

test('탈퇴 안내에 자가진단 기록 파기(SC-WD-NOTE)', async () => {
  expect(await render({ tab: 'edit-info' })).toContain(WITHDRAW_NOTE);
});
