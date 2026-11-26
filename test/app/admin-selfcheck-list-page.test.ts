import { beforeEach, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ADMIN_DIAGNOSIS_COPY } from '@/data/diagnosis/consent-copy';

const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';
type Call = { url: string; body: { params?: Record<string, unknown> } | null };
const calls: Call[] = [];
// 응답 순서대로 꺼내 쓴다
let responses: { status: number; body: unknown }[] = [];

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/v1/auth/session')) return new Response(JSON.stringify({ user: { id: 'admin-1', email: 'a@b.kr' } }), { status: 200 });
    const next = responses.shift() ?? { status: 500, body: { error: { code: 'internal', message: 'x' } } };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }),
);
vi.stubEnv('BARA_API_URL', 'http://api.test');
vi.mock('@/lib/db/service-key', () => ({ getServiceKey: async () => 'svc-key' }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'admin-tok' }) }), headers: async () => ({ get: () => null }) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
let tokenValid = true;
vi.mock('@/lib/supabase/admin-pii-reveal', () => ({ verifyRevealToken: async () => tokenValid }));
vi.mock('@/app/actions/admin-diagnosis', () => ({ hideDiagnosisResultContact: async () => {}, revealDiagnosisResultContact: async () => {} }));

import Page from '@/app/(admin)/admin/selfcheck/page';

const masked = (id: string, name: string) => ({
  id, createdAt: '2026-12-03T05:02:00.000Z', respondentName: name, phone: '010-****-5678', email: 'ab***@d.kr', isRevealed: false,
  learningExperience: 'none', totalScore: 61, recommendedTier: 'level1', userId: null,
});
const okRows = (rows: unknown[]) => ({ status: 200, body: { data: { result: 'ok', rows } } });
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
const listCalls = () => calls.filter((c) => c.url.includes('/v1/op/admin.listDiagnosisResults'));

beforeEach(() => {
  calls.length = 0;
  responses = [];
  tokenValid = true;
});

test('목록은 새 op로만 읽고(직접 조회 없음) 가린 이름(홍**)을 그대로 그린다, 안내 문구 표시', async () => {
  responses = [okRows([masked(R1, '홍**'), masked(R2, 'N**')])];
  const html = await render({ tier: 'level1' });
  expect(listCalls()).toHaveLength(1);
  expect(listCalls()[0].body).toEqual({ params: { tier: 'level1', memberOnly: 'all' } });
  expect(calls.some((c) => c.url.includes('/v1/query'))).toBe(false);
  expect(html).toContain(`href="/admin/selfcheck/${R1}">홍**</a>`);
  expect(html).toContain('N**');
  expect(html).toContain(ADMIN_DIAGNOSIS_COPY.maskHint);
  expect(html).not.toContain('bg-warning/10');
});

test('알 수 없는 필터 값은 all로 바꿔 보낸다(API 형식 오류 방지)', async () => {
  responses = [okRows([])];
  await render({ tier: 'bogus', memberOnly: 'x' });
  expect(listCalls()[0].body).toEqual({ params: { tier: 'all', memberOnly: 'all' } });
});

test('개인정보 보기: 토큰이 맞을 때만 revealId를 넘기고, 원문 행은 강조 + 가리기 버튼', async () => {
  responses = [okRows([{ ...masked(R1, '홍길동'), phone: '010-1234-5678', isRevealed: true }, masked(R2, 'N**')])];
  const html = await render({ revealPii: R1, revealToken: 'sig', revealExp: '9999999999' });
  expect(listCalls()[0].body).toEqual({ params: { tier: 'all', memberOnly: 'all', revealId: R1 } });
  expect(html).toContain('홍길동');
  expect(html).toMatch(/<tr class="bg-warning\/10">/);
  expect(html).toContain('가리기');
});

test('토큰 검증 실패면 revealId 없이(기록·원문 없음)', async () => {
  tokenValid = false;
  responses = [okRows([masked(R1, '홍**')])];
  await render({ revealPii: R1, revealToken: 'bad', revealExp: '9999999999' });
  expect(listCalls()[0].body?.params).not.toHaveProperty('revealId');
});

test('접속 기록 실패(503 log_failed)면 가린 목록을 다시 받아 원문 없이 안내', async () => {
  responses = [{ status: 503, body: { error: { code: 'unavailable', message: 'log_failed' } } }, okRows([masked(R1, '홍**')])];
  const html = await render({ revealPii: R1, revealToken: 'sig', revealExp: '9999999999' });
  expect(listCalls()).toHaveLength(2);
  expect(listCalls()[1].body?.params).not.toHaveProperty('revealId');
  expect(html).toContain('홍**');
  expect(html).toContain('접속 기록을 남기지 못해 개인정보를 보여 드리지 않았어요');
});

test('권한 없음·실패는 안내, 로그인 만료는 로그인으로', async () => {
  responses = [{ status: 200, body: { data: { result: 'forbidden' } } }];
  expect(await render()).toContain('진단 결과를 볼 권한이 없어요.');
  responses = [{ status: 500, body: { error: { code: 'internal', message: 'x' } } }];
  const html = await render();
  expect(html).toContain('진단 결과를 불러오지 못했어요');
  expect(html).not.toContain('진단 결과가 없어요.');
  responses = [{ status: 401, body: { error: { code: 'unauthenticated', message: 'x' } } }];
  await expect(render()).rejects.toThrow('REDIRECT:/sign-in');
});
