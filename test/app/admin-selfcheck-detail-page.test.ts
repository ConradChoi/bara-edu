import { beforeEach, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const ID = '55555555-5555-4555-8555-555555555555';
const SECRETS = ['비밀이름', '010-7777-8888', 'secret@example.com', 'A1:4'];
type Res = { ok: true; data: unknown } | { ok: false; status: number; error: { code: string; message: string } };
let apiResponse: Res;
const calls: string[] = [];

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string) => {
    calls.push(url);
    if (apiResponse.ok) return new Response(JSON.stringify(apiResponse.data), { status: 200 });
    return new Response(JSON.stringify({ error: apiResponse.error }), { status: apiResponse.status });
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
// 이전 경로(앱이 직접 조회하고 logAdminAccess를 따로 부르던 함수)가 다시 쓰이면 이 테스트가 깨지게 한다.
const supabaseQueries = vi.fn();
vi.mock('@/lib/supabase/admin-queries', () => new Proxy({}, { get: () => supabaseQueries }));

import Page from '@/app/(admin)/admin/selfcheck/[id]/page';

const detail = {
  result: 'ok', id: ID, createdAt: '2026-11-01T00:00:00.000Z', respondentName: '비밀이름', phone: '010-7777-8888', email: 'secret@example.com',
  learningExperience: 'none', totalScore: 10, recommendedTier: 'level1', userId: null,
  scoreTheory: 1, scoreReading: 2, scoreAnalysis: 3, scoreCounseling: 4, scoreCaseRecord: 5, scoreTeaching: 6,
  strengthAreas: ['theory'], improvementAreas: ['teaching'], answers: [{ itemCode: 'A1', score: 4 }],
};
const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ id: ID }) }));

beforeEach(() => {
  calls.length = 0;
  supabaseQueries.mockClear();
});

test('기록과 조회가 성공하면 원문을 그린다 (API 한 번 호출, 앱의 직접 조회 없음)', async () => {
  apiResponse = { ok: true, data: { data: detail } };
  const html = await render();
  for (const s of SECRETS) expect(html).toContain(s);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain('/v1/op/admin.getDiagnosisResultDetail');
  expect(supabaseQueries).not.toHaveBeenCalled();
});

test('접속 기록이 실패(503 log_failed)하면 이름·연락처·응답이 렌더 결과에 하나도 없고 안내만 보인다', async () => {
  apiResponse = { ok: false, status: 503, error: { code: 'unavailable', message: 'log_failed' } };
  const html = await render();
  for (const s of SECRETS) expect(html).not.toContain(s);
  expect(html).not.toContain('6영역 점수');
  expect(html).toContain('접속 기록을 남기지 못해');
  expect(supabaseQueries).not.toHaveBeenCalled();
});

test('그 밖의 API 실패(500, 네트워크)에도 원문이 없다', async () => {
  apiResponse = { ok: false, status: 500, error: { code: 'internal', message: 'x' } };
  let html = await render();
  for (const s of SECRETS) expect(html).not.toContain(s);
  expect(html).toContain('불러오지 못했어요');
  vi.mocked(fetch).mockRejectedValueOnce(new Error('down'));
  html = await render();
  expect(html).toContain('불러오지 못했어요');
});

test('없는 결과는 404, 로그인 만료는 로그인으로', async () => {
  apiResponse = { ok: true, data: { data: { result: 'not_found' } } };
  await expect(render()).rejects.toThrow('NOT_FOUND');
  apiResponse = { ok: false, status: 401, error: { code: 'unauthenticated', message: 'x' } };
  await expect(render()).rejects.toThrow('REDIRECT:/sign-in');
});
