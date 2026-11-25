import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
let adminId: string;
let adminToken: string;
let learnerId: string;
let learnerToken: string;

const q = async (sql: string, p: unknown[] = []) => (await ctx.adminPool.query(sql, p)).rows;

beforeAll(async () => {
  ctx = await setupTestDb();
  app = buildApp({ config: loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY }), pool: ctx.pool, mailer: new MemoryMailer(), storage: new MemoryStorage() });
  await app.ready();
  adminId = (await q("insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ('adm@example.com', now(), '{\"name\":\"관리자A\"}') returning id"))[0].id;
  await q(`begin; set local session_replication_role = replica; update profiles set role='admin' where id='${adminId}'; commit`);
  adminToken = (await createSession(ctx.pool, adminId, 30)).token;
  learnerId = (await q("insert into auth.users (email, email_confirmed_at) values ('lrn@example.com', now()) returning id"))[0].id;
  learnerToken = (await createSession(ctx.pool, learnerId, 30)).token;
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

const op = (name: string, params: object, token: string | undefined = adminToken, ip?: string) =>
  app.inject({
    method: 'POST', url: `/v1/op/${name}`,
    headers: { 'x-bara-service-key': KEY, ...(token ? { 'x-bara-session': token } : {}), ...(ip ? { 'x-bara-client-ip': ip } : {}) },
    payload: { params },
  });

const lead = async (userId: string | null = null) =>
  (await q("insert into diagnosis_leads (user_id, name, contact, message, consent_contact) values ($1, '문의자', '010-5555-6666', '문의 내용', true) returning id", [userId]))[0].id as string;
const leadRow = async (id: string) => (await q('select status, admin_note, handled_by, handled_at from diagnosis_leads where id = $1', [id]))[0];
const logs = (action = '수정') => q('select * from admin_access_logs where action = $1 order by created_at', [action]);
const call = async (params: object, token?: string, ip?: string) => {
  const r = await op('admin.updateDiagnosisLead', params, token, ip);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().data;
};

async function withFailingLog<T>(fn: () => Promise<T>): Promise<T> {
  await q(`create or replace function public.test_fail_log() returns trigger language plpgsql as $$ begin raise exception 'log down'; end $$`);
  await q('create trigger test_fail_log before insert on admin_access_logs for each row execute function public.test_fail_log()');
  try {
    return await fn();
  } finally {
    await q('drop trigger test_fail_log on admin_access_logs');
  }
}

// ---------------- 리드 상태 전환·메모 ----------------

test('연락함 표시: 상태·처리자·메모 변경과 접속 기록 1건(리드 id·항목만, 값 없음, 비회원은 target null)', async () => {
  const id = await lead();
  const d = await call({ leadId: id, change: 'contacted', note: '통화 완료 다음주 재연락' }, adminToken, '203.0.113.9');
  expect(d.result).toBe('ok');
  expect(await leadRow(id)).toMatchObject({ status: 'contacted', admin_note: '통화 완료 다음주 재연락', handled_by: adminId });
  const rows = (await logs()).filter((r) => r.detail.includes(id));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ admin_id: adminId, target_user_id: null, action: '수정', ip_address: '203.0.113.9' });
  expect(rows[0].detail).toBe(`강사과정 문의 ${id} fields=status,admin_note`);
  for (const v of ['통화', '010', '문의자']) expect(rows[0].detail).not.toContain(v);
});

test('회원이 낸 문의면 target_user_id는 그 회원', async () => {
  const id = await lead(learnerId);
  await call({ leadId: id, change: 'note', note: '메모' });
  const rows = (await logs()).filter((r) => r.detail.includes(id));
  expect(rows).toHaveLength(1);
  expect(rows[0].target_user_id).toBe(learnerId);
  expect(rows[0].detail).toBe(`강사과정 문의 ${id} fields=admin_note`);
});

test('종료: 사유 필수, 이전 상태 불일치면 already_processed(기록 없음)', async () => {
  const id = await lead();
  const bad = await op('admin.updateDiagnosisLead', { leadId: id, change: 'closed', fromStatus: 'new' });
  expect(bad.json().data).toMatchObject({ result: 'validation', field: 'note' });
  const ok = await call({ leadId: id, change: 'closed', fromStatus: 'new', note: '중복 접수' });
  expect(ok.result).toBe('ok');
  expect((await leadRow(id)).status).toBe('closed');
  const n = (await logs()).length;
  const again = await call({ leadId: id, change: 'contacted' });
  expect(again.result).toBe('already_processed');
  const again2 = await call({ leadId: id, change: 'closed', fromStatus: 'new', note: '또' });
  expect(again2.result).toBe('already_processed');
  expect((await logs()).length).toBe(n);
});

test('메모에 개인정보 패턴이 있으면 validation memo_has_pii, 변경·기록 없음. 길이 제한은 두지 않는다(긴 메모 허용)', async () => {
  const id = await lead();
  const n = (await logs()).length;
  for (const note of ['010-1234-5678로 연락', '홍길동@naver.com', '+82 10 1234 5678', '900101-1234567']) {
    const d = await call({ leadId: id, change: 'note', note });
    expect(d).toMatchObject({ result: 'validation', field: 'note', reason: 'memo_has_pii' });
  }
  const d2 = await call({ leadId: id, change: 'contacted', note: '010 1234 5678' });
  expect(d2.reason).toBe('memo_has_pii');
  expect((await leadRow(id)).status).toBe('new');
  expect((await logs()).length).toBe(n);
  expect((await call({ leadId: id, change: 'note', note: '1줄\n2줄\t3' })).result).toBe('ok');
  expect((await call({ leadId: id, change: 'note', note: '010\n1234\n5678' })).reason).toBe('memo_has_pii');
  const long = '가'.repeat(500) + ' 2026-11-26 14:12';
  expect((await call({ leadId: id, change: 'note', note: long })).result).toBe('ok');
});

test('메모가 현재와 같으면 unchanged(기록 없음), 비우기는 변경으로 기록', async () => {
  const id = await lead();
  await call({ leadId: id, change: 'note', note: '가' });
  const n = (await logs()).length;
  expect((await call({ leadId: id, change: 'note', note: '가' })).result).toBe('unchanged');
  expect((await logs()).length).toBe(n);
  expect((await call({ leadId: id, change: 'note', note: '' })).result).toBe('ok');
  expect((await leadRow(id)).admin_note).toBeNull();
  expect((await logs()).length).toBe(n + 1);
});

test('접속 기록 insert가 실패하면 변경 전체를 롤백하고 503 log_failed', async () => {
  const id = await lead();
  await withFailingLog(async () => {
    for (const params of [{ leadId: id, change: 'contacted', note: 'a' }, { leadId: id, change: 'closed', fromStatus: 'new', note: 'b' }, { leadId: id, change: 'note', note: 'c' }]) {
      const r = await op('admin.updateDiagnosisLead', params);
      expect(r.statusCode).toBe(503);
      expect(r.json().error).toMatchObject({ code: 'unavailable', message: 'log_failed' });
    }
  });
  expect(await leadRow(id)).toMatchObject({ status: 'new', admin_note: null, handled_by: null });
});

test('관리자만: 학습자·세션 없음 거절, 없는 리드는 not_found', async () => {
  const id = await lead();
  expect((await call({ leadId: id, change: 'note', note: 'x' }, learnerToken)).result).toBe('forbidden');
  const r = await op('admin.updateDiagnosisLead', { leadId: id, change: 'note', note: 'x' }, '');
  expect(r.statusCode).toBe(401);
  expect((await leadRow(id)).admin_note).toBeNull();
  expect((await call({ leadId: '11111111-1111-4111-8111-111111111111', change: 'note', note: 'x' })).result).toBe('not_found');
});

// ---------------- 진단 결과 상세: 기록과 조회를 한 트랜잭션으로 ----------------

async function result(userId: string | null = null) {
  const id = (
    await q(
      `insert into diagnosis_results (user_id, respondent_name, phone, email, learning_experience, age_confirmed, version, score_theory, score_reading, score_analysis, score_counseling, score_case_record, score_teaching, total_score, recommended_tier, consent_privacy, strength_areas, improvement_areas)
       select $1,'비밀이름','010-7777-8888','secret@example.com', e, true, 'v1', 1,2,3,4,5,6, 10, t, true, array['theory'], array['teaching'] from (select (enum_range(null::diagnosis_experience))[1] e, (enum_range(null::diagnosis_tier))[1] t) s
       returning id`,
      [userId],
    )
  )[0].id as string;
  await q("insert into diagnosis_answers (result_id, item_code, score) values ($1,'A1',3)", [id]);
  return id;
}
const detail = (id: string, token?: string, ip?: string) => op('admin.getDiagnosisResultDetail', { id }, token, ip);

test('상세 조회: 원문과 응답을 돌려주고 같은 호출에서 조회 기록 1건(값 없음)', async () => {
  const id = await result();
  const r = await detail(id, adminToken, '203.0.113.5');
  expect(r.statusCode, r.body).toBe(200);
  const d = r.json().data;
  expect(d).toMatchObject({ result: 'ok', respondentName: '비밀이름', phone: '010-7777-8888', email: 'secret@example.com', userId: null });
  expect(d.answers).toEqual([{ itemCode: 'A1', score: 3 }]);
  expect(d.strengthAreas).toEqual(['theory']);
  const rows = (await logs('조회')).filter((x) => x.detail === `진단 결과 상세(${id})`);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ admin_id: adminId, target_user_id: null, ip_address: '203.0.113.5' });
});

test('접속 기록이 실패하면 503 log_failed이고 응답 어디에도 원문이 없다', async () => {
  const id = await result();
  await withFailingLog(async () => {
    const r = await detail(id, adminToken);
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toMatchObject({ code: 'unavailable', message: 'log_failed' });
    for (const v of ['비밀이름', '7777', 'secret@example.com']) expect(r.body).not.toContain(v);
  });
});

test('상세: 관리자만, 없는 id는 not_found(기록 없음)', async () => {
  const id = await result();
  expect((await detail(id, learnerToken)).json().data).toEqual({ result: 'forbidden' });
  const n = (await logs('조회')).length;
  expect((await detail('11111111-1111-4111-8111-111111111111')).json().data).toEqual({ result: 'not_found' });
  expect((await logs('조회')).length).toBe(n);
});
