import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { WITHDRAWAL_REASON_KEYS } from '../src/auth/withdraw-reasons.js';
import { issueEmailToken } from '../src/auth/tokens.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
let storage: MemoryStorage;

beforeAll(async () => {
  ctx = await setupTestDb();
  storage = new MemoryStorage();
  app = buildApp({ config, pool: ctx.pool, mailer: new MemoryMailer(), storage });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

async function newUser(name: string) {
  const u = await ctx.adminPool.query('insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, now(), $2) returning id', [
    `${name}@example.com`,
    { name },
  ]);
  const id = u.rows[0].id as string;
  const { token } = await createSession(ctx.pool, id, 30);
  return { id, token };
}

const q = async (sql: string, p: unknown[] = []) => (await ctx.adminPool.query(sql, p)).rows;
const count = async (table: string, uid: string) => Number((await q(`select count(*) c from ${table} where user_id = $1`, [uid]))[0].c);
const TABLES = ['progress', 'quiz_submissions', 'assignment_submissions', 'course_exam_submissions', 'course_exam_attempt_resets', 'diagnosis_leads'];

async function seed(uid: string, adminId: string, lessonId: string, courseId: string) {
  await q('insert into progress (user_id, lesson_id) values ($1,$2)', [uid, lessonId]);
  await q('insert into quiz_submissions (user_id, lesson_id, score) values ($1,$2,80)', [uid, lessonId]);
  await q("insert into assignment_submissions (user_id, lesson_id, content) values ($1,$2,'c')", [uid, lessonId]);
  await q('insert into course_exam_submissions (user_id, course_id, score, passed, attempt_no) values ($1,$2,90,true,1)', [uid, courseId]);
  await q("insert into course_exam_attempt_resets (user_id, course_id, reason, reset_by) values ($1,$2,'r',$3)", [uid, courseId, adminId]);
  await q("insert into diagnosis_leads (user_id, name, contact, consent_contact) values ($1,'n','c',true)", [uid]);
  await q(
    `insert into diagnosis_results (user_id, respondent_name, phone, email, certificate_level, learning_experience, age_confirmed, version, score_theory, score_reading, score_analysis, score_counseling, score_case_record, score_teaching, total_score, recommended_tier, consent_privacy)
     select $1,'이름','010','a@b.c','lv', e, true, 'v1', 1,2,3,4,5,6, 10, t, true from (select (enum_range(null::diagnosis_experience))[1] e, (enum_range(null::diagnosis_tier))[1] t) s`,
    [uid],
  );
}

const withdraw = (token: string | undefined, body: unknown = { reason: 'no_longer_needed' }) =>
  app.inject({
    method: 'POST',
    url: '/v1/account/withdraw',
    headers: { 'x-bara-service-key': KEY, ...(token ? { 'x-bara-session': token } : {}) },
    payload: body as object,
  });
const sessionCount = async (uid: string) => Number((await q('select count(*) c from auth.sessions where user_id = $1', [uid]))[0].c);

async function course(slug: string, lessons = 2) {
  const c = (await q('insert into courses (title, slug) values ($1,$1) returning id', [slug]))[0].id as string;
  const ls: string[] = [];
  for (let i = 0; i < lessons; i++) ls.push((await q("insert into lessons (course_id, title) values ($1,'l') returning id", [c]))[0].id);
  return { id: c, lessons: ls };
}

test('탈퇴: 한 번의 호출로 프로필·계정 익명화, 학습 이력 파기, 전체 세션 삭제, 사진 삭제', async () => {
  const a = await newUser('alice');
  const b = await newUser('bobby');
  const adm = await newUser('adm');
  const c = await course('c-ok');
  await seed(a.id, adm.id, c.lessons[0], c.id);
  await seed(b.id, adm.id, c.lessons[0], c.id);
  await q("update profiles set phone='010', address='서울', photo_path=$2 where id=$1", [a.id, `${a.id}/photo`]);
  await createSession(ctx.pool, a.id, 30);
  await storage.put(`${a.id}/photo`, Buffer.from('x'), 'image/jpeg');
  await storage.put(`${b.id}/photo`, Buffer.from('x'), 'image/jpeg');
  expect(await sessionCount(a.id)).toBe(2);

  const r = await withdraw(a.token, { reason: 'inconvenient', detail: '불편해요' });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ ok: true });

  const anon = `withdrawn+${a.id}@deleted.invalid`;
  const p = (await q('select name, phone, email, address, photo_path, status, withdrawn_at, withdrawal_reason, withdrawal_reason_detail from profiles where id=$1', [a.id]))[0];
  expect(p).toMatchObject({ name: '탈퇴한 회원', phone: null, email: anon, address: null, photo_path: null, status: 'withdrawn', withdrawal_reason: 'inconvenient', withdrawal_reason_detail: '불편해요' });
  expect(p.withdrawn_at).not.toBeNull();
  const u = (await q('select email, raw_user_meta_data from auth.users where id=$1', [a.id]))[0];
  expect(u).toEqual({ email: anon, raw_user_meta_data: {} });
  expect(await sessionCount(a.id)).toBe(0);
  for (const t of TABLES) {
    expect(await count(t, a.id), t).toBe(0);
    expect(await count(t, b.id), t).toBe(1);
  }
  const ra = (await q('select respondent_name, phone, email, certificate_level, score_theory from diagnosis_results where user_id = $1', [a.id]))[0];
  expect(ra).toEqual({ respondent_name: null, phone: null, email: null, certificate_level: null, score_theory: 1 });
  const rb = (await q('select respondent_name, email from diagnosis_results where user_id = $1', [b.id]))[0];
  expect(rb).toEqual({ respondent_name: '이름', email: 'a@b.c' });
  const bp = (await q('select status, name from profiles where id=$1', [b.id]))[0];
  expect(bp).toMatchObject({ status: 'active', name: 'bobby' });
  expect(storage.objects.has(`${a.id}/photo`)).toBe(false);
  expect(storage.objects.has(`${b.id}/photo`)).toBe(true);
  // 세션이 모두 사라져 이후 요청은 401
  expect((await withdraw(a.token)).statusCode).toBe(401);
});

test('탈퇴: 거래·수료 기록은 user_id만으로 보존', async () => {
  const a = await newUser('keep1');
  const c = await course('c-keep', 1);
  await q("insert into enrollments (user_id, course_id, status) values ($1,$2,'rejected')", [a.id, c.id]);
  expect((await withdraw(a.token)).statusCode).toBe(200);
  expect(Number((await q('select count(*) c from enrollments where user_id=$1', [a.id]))[0].c)).toBe(1);
});

test('탈퇴: 진행 중 수강(입금 대기·미수료 승인)이 있으면 409 active_enrollment, 아무것도 바뀌지 않음', async () => {
  const pending = await newUser('pend1');
  const approved = await newUser('appr1');
  const adm = await newUser('adm2');
  const c1 = await course('c-pend');
  const c2 = await course('c-appr');
  await q("insert into enrollments (user_id, course_id, status, payment_due_at) values ($1,$2,'pending', now() + interval '1 day')", [pending.id, c1.id]);
  await q("insert into enrollments (user_id, course_id, status) values ($1,$2,'approved')", [approved.id, c2.id]);
  await q('insert into progress (user_id, lesson_id, completed_at) values ($1,$2,now())', [approved.id, c2.lessons[0]]);
  await seed(approved.id, adm.id, c2.lessons[1], c2.id);
  for (const u of [pending, approved]) {
    const r = await withdraw(u.token);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('conflict');
    expect(r.json().error.message).toBe('active_enrollment');
    expect((await q('select status from profiles where id=$1', [u.id]))[0].status).toBe('active');
    expect(await sessionCount(u.id)).toBe(1);
  }
  expect(await count('quiz_submissions', approved.id)).toBe(1);
});

test('탈퇴: 만료된 입금 대기·반려, 전 강의 수료한 승인 건은 막지 않는다', async () => {
  const a = await newUser('done1');
  const c1 = await course('c-done');
  const c2 = await course('c-exp', 1);
  await q("insert into enrollments (user_id, course_id, status) values ($1,$2,'approved')", [a.id, c1.id]);
  for (const l of c1.lessons) await q('insert into progress (user_id, lesson_id, completed_at) values ($1,$2,now())', [a.id, l]);
  await q("insert into enrollments (user_id, course_id, status, payment_due_at) values ($1,$2,'pending', now() - interval '1 day')", [a.id, c2.id]);
  expect((await withdraw(a.token)).statusCode).toBe(200);
});

test('탈퇴: 강의가 0개인 승인 강좌는 진행 중으로 본다(기존 규칙 유지)', async () => {
  const a = await newUser('empty1');
  const c = await course('c-empty', 0);
  await q("insert into enrollments (user_id, course_id, status) values ($1,$2,'approved')", [a.id, c.id]);
  expect((await withdraw(a.token)).statusCode).toBe(409);
});

test('탈퇴: 중간에 실패하면 전부 롤백(프로필·계정·학습 이력·세션 그대로), 사진도 지우지 않는다', async () => {
  const a = await newUser('rollback1');
  const adm = await newUser('adm3');
  const c = await course('c-rb');
  await seed(a.id, adm.id, c.lessons[0], c.id);
  await q("update profiles set phone='010', address='서울' where id=$1", [a.id]);
  await storage.put(`${a.id}/photo`, Buffer.from('x'), 'image/jpeg');
  await q(`create function auth.test_block_session_delete() returns trigger language plpgsql as $$ begin raise exception 'blocked'; end $$`);
  await q('create trigger test_block_session_delete before delete on auth.sessions for each row execute function auth.test_block_session_delete()');
  try {
    const r = await withdraw(a.token);
    expect(r.statusCode).toBe(500);
  } finally {
    await q('drop trigger test_block_session_delete on auth.sessions');
    await q('drop function auth.test_block_session_delete()');
  }
  const p = (await q('select name, phone, email, status from profiles where id=$1', [a.id]))[0];
  expect(p).toMatchObject({ name: 'rollback1', phone: '010', status: 'active' });
  expect((await q('select email from auth.users where id=$1', [a.id]))[0].email).toBe('rollback1@example.com');
  for (const t of TABLES) expect(await count(t, a.id), t).toBe(1);
  expect((await q('select respondent_name from diagnosis_results where user_id=$1', [a.id]))[0].respondent_name).toBe('이름');
  expect(await sessionCount(a.id)).toBe(1);
  expect(storage.objects.has(`${a.id}/photo`)).toBe(true);
  // 장애가 풀린 뒤 다시 시도하면 성공
  expect((await withdraw(a.token)).statusCode).toBe(200);
});

test('탈퇴: 사진 삭제가 실패해도 탈퇴는 성공(커밋 뒤 로그만)', async () => {
  const a = await newUser('photofail1');
  const failing = { ...storage, put: storage.put.bind(storage), signedUrl: storage.signedUrl.bind(storage), remove: async () => { throw new Error('s3 down'); } };
  const failApp = buildApp({ config, pool: ctx.pool, mailer: new MemoryMailer(), storage: failing as never });
  const r = await failApp.inject({ method: 'POST', url: '/v1/account/withdraw', headers: { 'x-bara-service-key': KEY, 'x-bara-session': a.token }, payload: { reason: 'other' } });
  await failApp.close();
  expect(r.statusCode).toBe(200);
  expect((await q('select status from profiles where id=$1', [a.id]))[0].status).toBe('withdrawn');
});

test('탈퇴 후 기존 이메일로 다시 가입할 수 있고, 기존 비밀번호로는 로그인할 수 없다', async () => {
  const a = await newUser('again1');
  expect((await withdraw(a.token)).statusCode).toBe(200);
  const s = await app.inject({ method: 'POST', url: '/v1/auth/signup', headers: { 'x-bara-service-key': KEY }, payload: { email: 'again1@example.com', password: 'password1', name: '새회원', origin: 'https://bara-edu.kr' } });
  expect(s.json()).toEqual({ status: 'pending_confirmation' });
  expect((await q("select count(*) c from auth.users where email = 'again1@example.com'"))[0].c).toBe('1');
});

test('탈퇴: 입력 검증 — 세션 없음 401, 사유 누락·형식 오류·상세 과다 400, 아무것도 바뀌지 않음', async () => {
  const a = await newUser('valid1');
  expect((await withdraw(undefined)).statusCode).toBe(401);
  for (const body of [{}, { reason: '' }, { reason: 'BAD REASON!' }, { reason: 'made_up' }, { reason: 'no_longer_needed ' }, { reason: 'other', detail: 'x'.repeat(1001) }, { reason: 'other', userId: a.id }]) {
    const r = await withdraw(a.token, body);
    expect(r.statusCode, JSON.stringify(body)).toBe(400);
  }
  expect((await q('select status from profiles where id=$1', [a.id]))[0].status).toBe('active');
  expect(await sessionCount(a.id)).toBe(1);
});

test('옛 경로(withdraw-anonymize, account.withdrawCleanup)는 없다', async () => {
  const a = await newUser('old1');
  const h = { 'x-bara-service-key': KEY, 'x-bara-session': a.token };
  expect((await app.inject({ method: 'POST', url: '/v1/auth/withdraw-anonymize', headers: h, payload: {} })).statusCode).toBe(404);
  expect((await app.inject({ method: 'POST', url: '/v1/op/account.withdrawCleanup', headers: h, payload: { params: {} } })).statusCode).toBe(404);
});

test('탈퇴 후 남아 있던 confirm·recovery 토큰으로 세션·비밀번호를 얻을 수 없다', async () => {
  const a = await newUser('tok1');
  const confirm = await issueEmailToken(ctx.pool, a.id, 'confirm');
  const recovery = await issueEmailToken(ctx.pool, a.id, 'recovery');
  expect((await withdraw(a.token)).statusCode).toBe(200);
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, headers: { 'x-bara-service-key': KEY }, payload });
  expect((await post('/v1/auth/verify-email', { token: confirm })).statusCode).toBe(400);
  expect((await post('/v1/auth/reset-password', { token: recovery, newPassword: 'hijacked123' })).statusCode).toBe(400);
  expect((await post('/v1/auth/login', { email: `withdrawn+${a.id}@deleted.invalid`, password: 'hijacked123' })).statusCode).toBe(401);
});

test('탈퇴: 고정 목록의 모든 사유 key를 받는다', async () => {
  for (const key of WITHDRAWAL_REASON_KEYS) {
    const a = await newUser(`reason-${key}`);
    expect((await withdraw(a.token, { reason: key })).statusCode, key).toBe(200);
    expect((await q('select withdrawal_reason from profiles where id=$1', [a.id]))[0].withdrawal_reason).toBe(key);
  }
});
