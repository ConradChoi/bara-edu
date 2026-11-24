import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;

beforeAll(async () => {
  ctx = await setupTestDb();
  app = buildApp({ config, pool: ctx.pool, mailer: new MemoryMailer(), storage: new MemoryStorage() });
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

test('withdrawCleanup: A의 학습 이력·진단 PII만 지워지고 B는 그대로', async () => {
  const a = await newUser('alice');
  const b = await newUser('bobby');
  const adm = await newUser('adm');
  const course = (await q("insert into courses (title, slug) values ('c','c-1') returning id"))[0].id;
  const lesson = (await q("insert into lessons (course_id, title) values ($1,'l') returning id", [course]))[0].id;
  await seed(a.id, adm.id, lesson, course);
  await seed(b.id, adm.id, lesson, course);

  const r = await app.inject({
    method: 'POST',
    url: '/v1/op/account.withdrawCleanup',
    headers: { 'x-bara-service-key': KEY, 'x-bara-session': a.token },
    payload: { params: {} },
  });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ data: { ok: true } });

  for (const t of TABLES) {
    expect(await count(t, a.id), t).toBe(0);
    expect(await count(t, b.id), t).toBe(1);
  }
  const ra = (await q('select respondent_name, phone, email, certificate_level, score_theory from diagnosis_results where user_id = $1', [a.id]))[0];
  expect(ra).toEqual({ respondent_name: null, phone: null, email: null, certificate_level: null, score_theory: 1 });
  const rb = (await q('select respondent_name, phone, email, certificate_level from diagnosis_results where user_id = $1', [b.id]))[0];
  expect(rb).toEqual({ respondent_name: '이름', phone: '010', email: 'a@b.c', certificate_level: 'lv' });
});

test('withdrawCleanup: 세션 없음 401, 추가 params 400', async () => {
  const a = await newUser('carol');
  const call = (token: string | undefined, params: unknown) =>
    app.inject({
      method: 'POST',
      url: '/v1/op/account.withdrawCleanup',
      headers: { 'x-bara-service-key': KEY, ...(token ? { 'x-bara-session': token } : {}) },
      payload: { params } as any,
    });
  expect((await call(undefined, {})).statusCode).toBe(401);
  const r = await call(a.token, { userId: a.id });
  expect(r.statusCode).toBe(400);
  expect(r.json().error.code).toBe('validation');
});
