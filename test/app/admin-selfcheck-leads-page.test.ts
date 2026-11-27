import { beforeEach, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// 강사과정 문의 목록(2026-11-27): diagnosis_leads 직접 조회 대신 API op admin.listDiagnosisLeads만 쓴다.
const L1 = '11111111-1111-4111-8111-111111111111';
const L2 = '22222222-2222-4222-8222-222222222222';
type Call = { url: string; body: { params?: Record<string, unknown> } | null };
const calls: Call[] = [];
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
vi.mock('@/app/actions/admin-diagnosis', () => ({
  closeLead: async () => {},
  hideDiagnosisLeadContact: async () => {},
  markLeadContacted: async () => {},
  revealDiagnosisLeadContact: async () => {},
  updateLeadNote: async () => {},
}));

import Page from '@/app/(admin)/admin/selfcheck/leads/page';

const masked = (id: string, name: string, contact = '010-****-5678') => ({
  id, createdAt: '2026-12-03T05:02:00.000Z', resultId: null, name, contact, isRevealed: false,
  message: '문의', messageMasked: false, status: 'new', adminNote: null, handledAt: null, userId: null,
});
const okRows = (rows: unknown[]) => ({ status: 200, body: { data: { result: 'ok', rows } } });
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
const listCalls = () => calls.filter((c) => c.url.includes('/v1/op/admin.listDiagnosisLeads'));

beforeEach(() => {
  calls.length = 0;
  responses = [];
  tokenValid = true;
});

test('목록은 새 op로만 읽고(직접 조회 없음) 가린 이름·연락처를 그대로 그린다', async () => {
  responses = [okRows([masked(L1, '홍**'), masked(L2, 'N**', 'nv***@example.com')])];
  const html = await render();
  expect(listCalls()).toHaveLength(1);
  expect(listCalls()[0].body).toEqual({ params: { status: 'all' } });
  expect(calls.some((c) => c.url.includes('/v1/query'))).toBe(false);
  expect(html).toContain('홍**');
  expect(html).toContain('nv***@example.com');
});

test('개인정보 보기: 토큰이 맞을 때만 revealId를 넘기고 원문을 그린다', async () => {
  responses = [okRows([{ ...masked(L1, '홍길동', '010-1234-5678'), isRevealed: true }])];
  const html = await render({ revealPii: L1, revealToken: 'sig', revealExp: '9999999999' });
  expect(listCalls()[0].body).toEqual({ params: { status: 'all', revealId: L1 } });
  expect(html).toContain('홍길동');
  expect(html).toContain('010-1234-5678');
});

test('토큰 검증 실패면 revealId 없이 요청한다', async () => {
  tokenValid = false;
  responses = [okRows([masked(L1, '홍**')])];
  await render({ revealPii: L1, revealToken: 'bad', revealExp: '9999999999' });
  expect(listCalls()[0].body?.params).not.toHaveProperty('revealId');
});

test('접속 기록 실패(503 log_failed)면 가린 목록을 다시 받아 원문 없이 안내', async () => {
  responses = [{ status: 503, body: { error: { code: 'unavailable', message: 'log_failed' } } }, okRows([masked(L1, '홍**')])];
  const html = await render({ revealPii: L1, revealToken: 'sig', revealExp: '9999999999' });
  expect(listCalls()).toHaveLength(2);
  expect(listCalls()[1].body?.params).not.toHaveProperty('revealId');
  expect(html).toContain('홍**');
  expect(html).toContain('접속 기록을 남기지 못해 개인정보를 보여 드리지 않았어요');
});

test('권한 없음·실패는 안내(빈 목록 문구 없음), 로그인 만료는 로그인으로', async () => {
  responses = [{ status: 200, body: { data: { result: 'forbidden' } } }];
  expect(await render()).toContain('문의 목록을 볼 권한이 없어요.');
  responses = [{ status: 500, body: { error: { code: 'internal', message: 'x' } } }];
  const html = await render();
  expect(html).toContain('문의 목록을 불러오지 못했어요');
  expect(html).not.toContain('접수된 문의가 없어요.');
  responses = [{ status: 401, body: { error: { code: 'unauthenticated', message: 'x' } } }];
  await expect(render()).rejects.toThrow('REDIRECT:/sign-in');
});

test('문의 내용: 가린 미리보기면 안내 문구, 원문 행이면 전문·안내 없음', async () => {
  responses = [okRows([{ ...masked(L1, '홍**'), message: '***로 연락 주세요', messageMasked: true }])];
  const html = await render();
  expect(html).toContain('***로 연락 주세요');
  expect(html).toContain('전문은 [개인정보 보기]로 확인');
  responses = [okRows([{ ...masked(L1, '홍길동', '010-1234-5678'), isRevealed: true, message: '010-9999-8888로 연락 주세요', messageMasked: false }])];
  const html2 = await render({ revealPii: L1, revealToken: 'sig', revealExp: '9999999999' });
  expect(html2).toContain('010-9999-8888로 연락 주세요');
  expect(html2).not.toContain('전문은 [개인정보 보기]로 확인');
});

const MISSED = '보려던 문의의 개인정보를 열지 못했어요';

test('개인정보 보기로 왔는데 원문 행이 없으면(토큰 만료·삭제·목록 밖) 안내, 보기를 안 눌렀거나 원문을 받았으면 없음', async () => {
  tokenValid = false;
  responses = [okRows([masked(L1, '홍**')])];
  expect(await render({ revealPii: L1, revealToken: 'old', revealExp: '1' })).toContain(MISSED);
  tokenValid = true;
  responses = [okRows([masked(L2, 'N**')])];
  expect(await render({ revealPii: L1, revealToken: 'sig', revealExp: '9999999999' })).toContain(MISSED);
  responses = [okRows([{ ...masked(L1, '홍길동', '010-1234-5678'), isRevealed: true }])];
  expect(await render({ revealPii: L1, revealToken: 'sig', revealExp: '9999999999' })).not.toContain(MISSED);
  responses = [okRows([masked(L1, '홍**')])];
  expect(await render()).not.toContain(MISSED);
  // 기록 실패는 그 안내만(겹쳐 보이지 않게)
  responses = [{ status: 503, body: { error: { code: 'unavailable', message: 'log_failed' } } }, okRows([masked(L1, '홍**')])];
  expect(await render({ revealPii: L1, revealToken: 'sig', revealExp: '9999999999' })).not.toContain(MISSED);
});
