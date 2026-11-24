import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { loadRpcCatalog, RPC_ALLOW } from '../src/query/rpc.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const C1 = '22222222-2222-4222-8222-222222222222';

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
let tokenA: string;

beforeAll(async () => {
  ctx = await setupTestDb();
  await ctx.adminPool.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [A, 'hong@example.com', JSON.stringify({ name: '홍길동' })]);
  tokenA = (await createSession(ctx.pool, A, 30)).token;
  await ctx.adminPool.query(`insert into courses (id, title, slug, fee, status) values ($1, '도형심리 1급', 'shape-1', 150000, 'active')`, [C1]);
  app = buildApp({ config, pool: ctx.pool, mailer: new MemoryMailer(), storage: new MemoryStorage() });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

function rpc(fn: string, args: unknown, user?: string) {
  const headers: Record<string, string> = { 'x-bara-service-key': KEY };
  if (user) headers['x-bara-session'] = user;
  return app.inject({ method: 'POST', url: `/v1/rpc/${fn}`, headers, payload: args === undefined ? undefined : ({ args } as any) });
}

test('카탈로그는 허용 함수 16개를 모두 단일 시그니처로 적재', async () => {
  const cat = await loadRpcCatalog(ctx.pool);
  expect([...cat.keys()].sort()).toEqual([...RPC_ALLOW].sort());
  expect(RPC_ALLOW).toHaveLength(16);
  expect(cat.get('submit_diagnosis')!.args.find((a) => a.name === 'p_utm_source')!.hasDefault).toBe(true);
  expect(cat.get('get_my_diagnosis_results')!.setof).toBe(true);
  expect(cat.get('publish_legal_document')!.isVoid).toBe(true);
});

test('목록에 없는 함수(purge_unverified_signups) → 404', async () => {
  const r = await rpc('purge_unverified_signups', {}, tokenA);
  expect(r.statusCode).toBe(404);
  expect(r.json().error.code).toBe('not_found');
});

test('get_course_exam_readiness → [{question_count, has_unresolved_question}]', async () => {
  const r = await rpc('get_course_exam_readiness', { p_course_id: C1 }, tokenA);
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json()).toEqual({ data: [{ question_count: 0, has_unresolved_question: false }] });
});

test('get_my_exam_reset_at 스칼라 → 값 또는 null', async () => {
  const r = await rpc('get_my_exam_reset_at', { p_course_id: C1 }, tokenA);
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json()).toEqual({ data: null });
  await ctx.adminPool.query(`insert into course_exam_attempt_resets (user_id, course_id, reason, reset_at, reset_by) values ($1, $2, 'test', '2026-11-20T12:00:00.123Z', $1)`, [A, C1]);
  const r2 = await rpc('get_my_exam_reset_at', { p_course_id: C1 }, tokenA);
  expect(r2.json()).toEqual({ data: '2026-11-20T12:00:00.123+00:00' });
});

test('publish_legal_document 비관리자 → 400 db_error P0001 (not authorized), 비회원도 동일', async () => {
  const r = await rpc('publish_legal_document', { doc_id: C1 }, tokenA);
  expect(r.statusCode).toBe(400);
  expect(r.json().error).toMatchObject({ code: 'db_error', message: 'not authorized', sqlstate: 'P0001' });
});

test('execute 권한이 회수된 함수를 비회원이 호출 → 403 db_error 42501', async () => {
  const r = await rpc('get_my_diagnosis_results', {});
  expect(r.statusCode).toBe(403);
  expect(r.json().error.sqlstate).toBe('42501');
});

test('모르는 인자 이름 → 400, 기본값 없는 인자 누락 → 400, 잘못된 uuid → 400 validation', async () => {
  for (const args of [{ p_course_id: C1, p_x: 1 }, {}, { p_course_id: 'nope' }]) {
    const r = await rpc('get_course_exam_readiness', args, tokenA);
    expect(r.statusCode, JSON.stringify(args)).toBe(400);
    expect(r.json().error.code).toBe('validation');
  }
  const bad = await app.inject({ method: 'POST', url: '/v1/rpc/get_course_exam_readiness', headers: { 'x-bara-service-key': KEY }, payload: { args: [] } });
  expect(bad.statusCode).toBe(400);
});

test('submit_diagnosis 익명 → access_token 포함 배열, jsonb·enum·기본값 생략', async () => {
  const answers: Record<string, number> = {};
  for (const p of 'ABCDEF') for (let n = 1; n <= 5; n++) answers[`${p}${n}`] = 3;
  const r = await rpc('submit_diagnosis', {
    p_name: '홍길동',
    p_phone: '010-1234-5678',
    p_email: null,
    p_learning_experience: 'none',
    p_certificate_level: 'level1',
    p_consent_privacy: true,
    p_consent_privacy_doc_version: 1,
    p_age_confirmed: true,
    p_answers: answers,
  });
  expect(r.statusCode, r.body).toBe(200);
  const rows = r.json().data;
  expect(rows).toHaveLength(1);
  expect(rows[0].access_token).toMatch(/^[0-9a-f-]{36}$/);
  expect(typeof rows[0].total_score).toBe('number');
  expect(rows[0]).toHaveProperty('recommended_tier');
});

test('RPC 본문의 P0001 오류는 메시지 그대로 400 (비동의)', async () => {
  const r = await rpc('submit_diagnosis', {
    p_name: 'x', p_phone: '1', p_email: null, p_learning_experience: 'none', p_certificate_level: 'l',
    p_consent_privacy: false, p_consent_privacy_doc_version: 1, p_age_confirmed: true, p_answers: {},
  });
  expect(r.statusCode).toBe(400);
  expect(r.json().error.message).toBe('privacy consent required');
});

test('submit_course_exam 정상 제출·재제출 거절, 이어서 issue_certificate_self 발급·재호출 동일', async () => {
  const CAT = '33333333-3333-4333-8333-333333333333';
  const C2 = '44444444-4444-4444-8444-444444444444';
  const L = '55555555-5555-4555-8555-555555555555';
  const Q = '66666666-6666-4666-8666-666666666666';
  const OK = '77777777-7777-4777-8777-777777777777';
  await ctx.adminPool.query(`
    insert into categories (id, name, depth, is_certification) values ('${CAT}', '자격', 1, true);
    insert into courses (id, title, slug, fee, status, category_id, requires_exam, exam_pass_score, exam_max_attempts)
      values ('${C2}', '시험 강좌', 'exam-course', 0, 'active', '${CAT}', true, 60, 3);
    insert into lessons (id, course_id, title) values ('${L}', '${C2}', '1강');
    insert into enrollments (user_id, course_id, status) values ('${A}', '${C2}', 'approved');
    insert into progress (user_id, lesson_id, completed_at) values ('${A}', '${L}', now());
    insert into exam_question_bank (id, category_id, question) values ('${Q}', '${CAT}', '문항');
    insert into exam_bank_options (id, bank_question_id, label, is_correct) values ('${OK}', '${Q}', '정답', true);
    insert into course_exam_question_links (course_id, bank_question_id) values ('${C2}', '${Q}');
  `);
  const answers = [{ question_id: Q, option_id: OK }];
  const r = await rpc('submit_course_exam', { p_course_id: C2, p_answers: answers }, tokenA);
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json()).toEqual({ data: [{ score: 100, passed: true, attempt_no: 1 }] });
  const again = await rpc('submit_course_exam', { p_course_id: C2, p_answers: answers }, tokenA);
  expect(again.statusCode).toBe(400);
  expect(again.json().error.message).toBe('already passed');

  const cert = await rpc('issue_certificate_self', { p_course_id: C2 }, tokenA);
  expect(cert.statusCode, cert.body).toBe(200);
  const [issued] = cert.json().data;
  expect(issued.certificate_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(issued.issued_at).toMatch(/\+00:00$/);
  const reissue = await rpc('issue_certificate_self', { p_course_id: C2 }, tokenA);
  expect(reissue.json()).toEqual({ data: [issued] });
});
