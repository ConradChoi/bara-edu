import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { maskContact, maskEmail, maskMessagePreview, maskName, maskPhone } from '../src/ops/admin-diagnosis.js';
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
  adminToken = (await createSession(ctx.pool, adminId, 30, { mfaMethod: 'totp' })).token;
  learnerId = (await q("insert into auth.users (email, email_confirmed_at) values ('lrn@example.com', now()) returning id"))[0].id;
  learnerToken = (await createSession(ctx.pool, learnerId, 30, { mfaMethod: 'totp' })).token;
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
  expect(rows[0].detail).toBe(`강사과정 문의 ${id} fields=status,admin_note;to=contacted`);
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
      `insert into diagnosis_results (user_id, respondent_name, phone, email, learning_experience, age_confirmed, version, score_theory, score_reading, score_analysis, score_counseling, score_case_record, score_teaching, total_score, recommended_tier, consent_privacy, consent_privacy_doc_version, sensitive_consent_version, sensitive_consented_at, strength_areas, improvement_areas)
       select $1,'비밀이름','010-7777-8888','secret@example.com', e, true, 'v1', 1,2,3,4,5,6, 10, t, true, 10, 'sc-v1', '2026-12-03T05:02:00Z', array['theory'], array['teaching'] from (select (enum_range(null::diagnosis_experience))[1] e, (enum_range(null::diagnosis_tier))[1] t) s
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

test('상세: 동의 기록 3개(민감정보 동의 버전·시각, 처리방침 버전)를 함께 돌려준다', async () => {
  const id = await result();
  const d = (await detail(id)).json().data;
  expect(d).toMatchObject({ sensitiveConsentVersion: 'sc-v1', sensitiveConsentedAt: '2026-12-03T05:02:00.000Z', privacyDocVersion: 10 });
});

// ---------------- 진단 결과 목록: 이름 가림 + 개인정보 보기(API 계약 C4) ----------------

test('가림 규칙: 이름은 첫 글자 + ** (길이 무관), 연락처는 기존 앱 규칙', () => {
  expect(maskName('홍길동')).toBe('홍**');
  expect(maskName('남궁민수')).toBe('남**');
  expect(maskName('N')).toBe('N**');
  expect(maskName('  Nguyen Van A ')).toBe('N**');
  expect(maskName('𠮷野')).toBe('𠮷**'); // 코드 포인트 단위(반쪽 문자 없음)
  expect(maskName(null)).toBe('-');
  expect(maskName('  ')).toBe('-');
  expect(maskPhone('010-1234-5678')).toBe('010-****-5678');
  expect(maskPhone('12345')).toBe('***');
  expect(maskPhone(null)).toBe('-');
  expect(maskEmail('secret@example.com')).toBe('se***@example.com');
  expect(maskEmail('ab@x.kr')).toBe('***@x.kr');
  expect(maskEmail(null)).toBe('-');
  // 2026-11-27 강화(개인정보 점검 R-1·R-2)
  expect(maskPhone('02-123-4567')).toBe('02-****-67');
  expect(maskPhone('1234567')).toBe('***');
  expect(maskPhone('kakao hong19900101')).toBe('***');
  expect(maskEmail('hong@naver.com 010-1234-5678')).toBe('***');
  expect(maskEmail('hong@naver.com,01012345678')).toBe('***');
  expect(maskEmail('a@b@c.kr')).toBe('***');
  expect(maskEmail('hong@naver.com-010-1234-5678')).toBe('***');
  expect(maskEmail('hong@naver.com.01012345678')).toBe('***');
  expect(maskEmail('hong@naver')).toBe('***');
  expect(maskEmail('kim@mail.co.kr')).toBe('ki***@mail.co.kr');
  expect(maskPhone('900101-1234567')).toBe('***');
  expect(maskPhone('9001011234567')).toBe('***');
  expect(maskPhone('010-9025-5093')).toBe('010-****-5093');
});

async function listResult(name: string | null, phone: string | null, email: string | null, userId: string | null, tier: string, createdAt: string) {
  return (
    await q(
      `insert into diagnosis_results (user_id, respondent_name, phone, email, learning_experience, age_confirmed, version, score_theory, score_reading, score_analysis, score_counseling, score_case_record, score_teaching, total_score, recommended_tier, consent_privacy, sensitive_consent_version, sensitive_consented_at, created_at)
       values ($1,$2,$3,$4,'none', true, 'v1', 1,2,3,4,5,6, 77.5, $5, true, 'sc-v1', now(), $6) returning id`,
      [userId, name, phone, email, tier, createdAt],
    )
  )[0].id as string;
}
const list = (params: object, token?: string, ip?: string) => op('admin.listDiagnosisResults', params, token, ip);

test('목록: 이름·휴대전화·이메일이 가려져 오고 원문은 응답 어디에도 없다. 목록만 열면 접속 기록이 없다', async () => {
  await q('delete from diagnosis_results');
  const a = await listResult('김민지', '010-2222-3333', 'minji@example.com', learnerId, 'level1', '2026-12-02T00:00:00Z');
  const b = await listResult('Nguyen', null, 'nv@example.com', null, 'level2', '2026-12-03T00:00:00Z');
  const n0 = (await logs('조회')).length;
  const r = await list({});
  expect(r.statusCode, r.body).toBe(200);
  const d = r.json().data;
  expect(d.result).toBe('ok');
  expect(d.rows).toEqual([
    { id: b, createdAt: '2026-12-03T00:00:00.000Z', respondentName: 'N**', phone: '-', email: '***@example.com', isRevealed: false, learningExperience: 'none', totalScore: 77.5, recommendedTier: 'level2', userId: null },
    { id: a, createdAt: '2026-12-02T00:00:00.000Z', respondentName: '김**', phone: '010-****-3333', email: 'mi***@example.com', isRevealed: false, learningExperience: 'none', totalScore: 77.5, recommendedTier: 'level1', userId: learnerId },
  ]);
  for (const v of ['김민지', 'Nguyen', '2222', 'minji@', 'nv@']) expect(r.body).not.toContain(v);
  expect((await logs('조회')).length).toBe(n0);
});

test('목록 필터: 추천 단계·회원 여부', async () => {
  await q('delete from diagnosis_results');
  const a = await listResult('가', '01011112222', null, learnerId, 'level1', '2026-12-02T00:00:00Z');
  const b = await listResult('나', '01011113333', null, null, 'level2', '2026-12-03T00:00:00Z');
  const ids = async (p: object) => (await list(p)).json().data.rows.map((x: { id: string }) => x.id);
  expect(await ids({ tier: 'level1' })).toEqual([a]);
  expect(await ids({ tier: 'all', memberOnly: 'member' })).toEqual([a]);
  expect(await ids({ memberOnly: 'non_member' })).toEqual([b]);
  expect(await ids({ memberOnly: 'all' })).toEqual([b, a]);
  expect((await list({ tier: 'bogus' })).statusCode).toBe(400);
  expect((await list({ revealId: 'x' })).statusCode).toBe(400);
});

test('개인정보 보기: revealId 행만 이름·연락처 원문, 같은 호출에서 조회 기록 1건(fields=name,contact, 값 없음)', async () => {
  await q('delete from diagnosis_results');
  const a = await listResult('김민지', '010-2222-3333', 'minji@example.com', learnerId, 'level1', '2026-12-02T00:00:00Z');
  const b = await listResult('박서준', '010-4444-5555', null, null, 'level2', '2026-12-03T00:00:00Z');
  const r = await list({ revealId: a }, adminToken, '203.0.113.9');
  const rows = r.json().data.rows as Record<string, unknown>[];
  expect(rows.find((x) => x.id === a)).toMatchObject({ respondentName: '김민지', phone: '010-2222-3333', email: 'minji@example.com', isRevealed: true });
  expect(rows.find((x) => x.id === b)).toMatchObject({ respondentName: '박**', phone: '010-****-5555', email: '-', isRevealed: false });
  const lg = (await logs('조회')).filter((x) => x.detail === `진단 결과 개인정보 열람(${a}) fields=name,contact`);
  expect(lg).toHaveLength(1);
  expect(lg[0]).toMatchObject({ admin_id: adminId, target_user_id: learnerId, ip_address: '203.0.113.9' });
  for (const v of ['김민지', '2222', 'minji']) expect(lg[0].detail).not.toContain(v);
});

test('개인정보 보기: 필터 밖·없는 행이면 아무것도 열지 않고 기록도 없다', async () => {
  await q('delete from diagnosis_results');
  const a = await listResult('김민지', '010-2222-3333', null, learnerId, 'level1', '2026-12-02T00:00:00Z');
  const n0 = (await logs('조회')).length;
  for (const p of [{ revealId: a, tier: 'level2' }, { revealId: '11111111-1111-4111-8111-111111111111' }]) {
    const r = await list(p);
    expect(r.json().data.rows.every((x: { isRevealed: boolean }) => !x.isRevealed)).toBe(true);
    expect(r.body).not.toContain('김민지');
  }
  expect((await logs('조회')).length).toBe(n0);
});

test('개인정보 보기: 접속 기록이 실패하면 503 log_failed이고 원문이 없다', async () => {
  await q('delete from diagnosis_results');
  const a = await listResult('김민지', '010-2222-3333', 'minji@example.com', null, 'level1', '2026-12-02T00:00:00Z');
  await withFailingLog(async () => {
    const r = await list({ revealId: a });
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toMatchObject({ code: 'unavailable', message: 'log_failed' });
    for (const v of ['김민지', '2222', 'minji']) expect(r.body).not.toContain(v);
  });
});

test('목록: 관리자만(학습자 forbidden, 세션 없음 401)', async () => {
  expect((await list({}, learnerToken)).json().data).toEqual({ result: 'forbidden' });
  expect((await list({}, '')).statusCode).toBe(401);
});

// ---------------- 강사과정 문의 목록(admin.listDiagnosisLeads, 2026-11-27) ----------------

const leadAt = async (name: string, contact: string, userId: string | null, status: string, createdAt: string) =>
  (await q(
    `insert into diagnosis_leads (user_id, name, contact, message, consent_contact, status, created_at) values ($1,$2,$3,'문의 내용',true,$4::diagnosis_lead_status,$5) returning id`,
    [userId, name, contact, status, createdAt],
  ))[0].id as string;
const leads = (params: object, token?: string, ip?: string) => op('admin.listDiagnosisLeads', params, token, ip);

test('문의 목록: 이름·연락처(휴대전화·이메일)가 가려져 오고 원문은 응답에 없다. 목록만 열면 기록 없음', async () => {
  await q('delete from diagnosis_leads');
  const a = await leadAt('김민지', '010-2222-3333', learnerId, 'new', '2026-12-02T00:00:00Z');
  const b = await leadAt('Nguyen', 'nv.test@example.com', null, 'contacted', '2026-12-03T00:00:00Z');
  const n0 = (await logs('조회')).length;
  const r = await leads({});
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().data).toEqual({
    result: 'ok',
    rows: [
      { id: b, createdAt: '2026-12-03T00:00:00.000Z', resultId: null, name: 'N**', contact: 'nv***@example.com', isRevealed: false, message: '문의 내용', messageMasked: false, status: 'contacted', adminNote: null, handledAt: null, userId: null },
      { id: a, createdAt: '2026-12-02T00:00:00.000Z', resultId: null, name: '김**', contact: '010-****-3333', isRevealed: false, message: '문의 내용', messageMasked: false, status: 'new', adminNote: null, handledAt: null, userId: learnerId },
    ],
  });
  for (const v of ['김민지', 'Nguyen', '2222', 'nv.test']) expect(r.body).not.toContain(v);
  expect((await logs('조회')).length).toBe(n0);
});

test('문의 목록 필터: 상태, 잘못된 값은 400', async () => {
  await q('delete from diagnosis_leads');
  const a = await leadAt('가', '01011112222', null, 'new', '2026-12-02T00:00:00Z');
  const b = await leadAt('나', '01011113333', null, 'closed', '2026-12-03T00:00:00Z');
  const ids = async (p: object) => (await leads(p)).json().data.rows.map((x: { id: string }) => x.id);
  expect(await ids({ status: 'new' })).toEqual([a]);
  expect(await ids({ status: 'closed' })).toEqual([b]);
  expect(await ids({ status: 'all' })).toEqual([b, a]);
  expect((await leads({ status: 'bogus' })).statusCode).toBe(400);
  expect((await leads({ revealId: 'x' })).statusCode).toBe(400);
  expect((await leads({ extra: 1 })).statusCode).toBe(400);
});

test('문의 개인정보 보기: revealId 행만 원문, 같은 호출에서 조회 기록 1건(값 없음)', async () => {
  await q('delete from diagnosis_leads');
  const a = await leadAt('김민지', '010-2222-3333', learnerId, 'new', '2026-12-02T00:00:00Z');
  const b = await leadAt('박서준', 'park@example.com', null, 'new', '2026-12-03T00:00:00Z');
  const r = await leads({ revealId: a }, adminToken, '203.0.113.9');
  const rows = r.json().data.rows as Record<string, unknown>[];
  expect(rows.find((x) => x.id === a)).toMatchObject({ name: '김민지', contact: '010-2222-3333', isRevealed: true });
  expect(rows.find((x) => x.id === b)).toMatchObject({ name: '박**', contact: 'pa***@example.com', isRevealed: false });
  const lg = (await logs('조회')).filter((x) => x.detail === `강사과정 문의 이름·연락처 열람(${a}) fields=name,contact,message`);
  expect(lg).toHaveLength(1);
  expect(lg[0]).toMatchObject({ admin_id: adminId, target_user_id: learnerId, ip_address: '203.0.113.9' });
});

test('문의 개인정보 보기: 필터 밖·없는 행이면 열지 않고 기록 없음', async () => {
  await q('delete from diagnosis_leads');
  const a = await leadAt('김민지', '010-2222-3333', null, 'new', '2026-12-02T00:00:00Z');
  const n0 = (await logs('조회')).length;
  for (const p of [{ revealId: a, status: 'closed' }, { revealId: '11111111-1111-4111-8111-111111111111' }]) {
    const r = await leads(p);
    expect(r.json().data.rows.every((x: { isRevealed: boolean }) => !x.isRevealed)).toBe(true);
    expect(r.body).not.toContain('김민지');
  }
  expect((await logs('조회')).length).toBe(n0);
});

test('문의 개인정보 보기: 접속 기록이 실패하면 503 log_failed이고 원문이 없다', async () => {
  await q('delete from diagnosis_leads');
  const a = await leadAt('김민지', '010-2222-3333', null, 'new', '2026-12-02T00:00:00Z');
  await withFailingLog(async () => {
    const r = await leads({ revealId: a });
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toMatchObject({ code: 'unavailable', message: 'log_failed' });
    for (const v of ['김민지', '2222']) expect(r.body).not.toContain(v);
  });
});

test('문의 목록: 관리자만(학습자 forbidden, 세션 없음 401)', async () => {
  expect((await leads({}, learnerToken)).json().data).toEqual({ result: 'forbidden' });
  expect((await leads({}, '')).statusCode).toBe(401);
});

test('문의 연락처 가림 규칙: @ 있으면 이메일 규칙, 없으면 휴대전화 규칙, 빈 값·짧은 값', () => {
  expect(maskContact(null)).toBe('-');
  expect(maskContact('')).toBe('-');
  expect(maskContact('abc')).toBe('***');
  expect(maskContact('12345')).toBe('***');
  expect(maskContact('+82 10-1234-5678')).toBe('821-****-5678');
  expect(maskContact('02-123-4567')).toBe('02-****-67');
  expect(maskContact('hong@naver.com 010-1234-5678')).toBe('***');
  expect(maskContact('a@b.kr')).toBe('***@b.kr');
  expect(maskContact('@b.kr')).toBe('***');
  expect(maskContact('hong.gil@example.com')).toBe('ho***@example.com');
});

test('문의 내용 미리보기(R-3 B안): 이메일·전화·주민번호 모양은 ***, 40자 넘으면 자르고 …, 날짜·시각은 그대로', () => {
  expect(maskMessagePreview(null)).toEqual({ text: null, masked: false });
  expect(maskMessagePreview('강사과정 일정 궁금해요')).toEqual({ text: '강사과정 일정 궁금해요', masked: false });
  expect(maskMessagePreview('2026-11-26 14:12 이후 연락 주세요')).toEqual({ text: '2026-11-26 14:12 이후 연락 주세요', masked: false });
  expect(maskMessagePreview('010-1234-5678로 연락 주세요').text).toBe('***로 연락 주세요');
  expect(maskMessagePreview('01012345678').text).toBe('***');
  expect(maskMessagePreview('+82 10 1234 5678 해외입니다').text).toBe('*** 해외입니다');
  expect(maskMessagePreview('수강료 150,000원, 2026.11.26 ~ 2027.02.28').text).toBe('수강료 150,000원, 2026.11.26 ~ 2027.02.28');
  expect(maskMessagePreview('메일 hong@naver.com 으로').text).toBe('메일 *** 으로');
  expect(maskMessagePreview('메일 hong (at) naver.com').text).toBe('메일 ***');
  expect(maskMessagePreview('주민 900101-1234567').text).toBe('주민 ***');
  expect(maskMessagePreview('０１０-１２３４-５６７８').text).toBe('***');
  const long = '가'.repeat(50);
  expect(maskMessagePreview(long)).toEqual({ text: `${'가'.repeat(40)}…`, masked: true });
  expect(maskMessagePreview('줄\n바꿈').text).toBe('줄 바꿈');
});

test('문의 목록: message는 미리보기, [개인정보 보기] 행만 전문(접속 기록 fields에 message)', async () => {
  await q('delete from diagnosis_leads');
  const msg = '010-9999-8888로 저녁에 연락 부탁드립니다. 아이 상담 경험이 있어서 강사과정이 궁금합니다';
  const a = (await q("insert into diagnosis_leads (name, contact, message, consent_contact) values ('김민지', '010-2222-3333', $1, true) returning id", [msg]))[0].id as string;
  const r = await leads({});
  const row = r.json().data.rows[0];
  expect(row.messageMasked).toBe(true);
  expect(row.message.startsWith('***로 저녁에 연락')).toBe(true);
  expect(r.body).not.toContain('9999');
  expect(r.body).not.toContain('궁금합니다');
  const rv = (await leads({ revealId: a })).json().data.rows[0];
  expect(rv).toMatchObject({ message: msg, messageMasked: false, isRevealed: true });
});
