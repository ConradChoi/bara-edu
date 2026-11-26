import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
const users: Record<string, { id: string; token: string }> = {};
let courseId: string;
let lessonId: string;
let emptyLessonId: string;
// 문항 2개, 각 2개 선택지(첫 번째가 정답)
const Q: { id: string; ok: string; bad: string }[] = [];

const q = async (sql: string, p: unknown[] = []) => (await ctx.adminPool.query(sql, p)).rows;

async function addUser(key: string, status: 'active' | 'withdrawn' = 'active') {
  const id = (await q('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [`${key}@example.com`]))[0].id as string;
  if (status !== 'active') await q('update profiles set status = $2 where id = $1', [id, status]);
  users[key] = { id, token: (await createSession(ctx.pool, id, 30)).token };
}

beforeAll(async () => {
  ctx = await setupTestDb();
  app = buildApp({ config, pool: ctx.pool, mailer: new MemoryMailer(), storage: new MemoryStorage() });
  await app.ready();
  for (const k of ['learner', 'other', 'pending', 'rejected', 'racer1', 'racer2']) await addUser(k);
  await addUser('gone', 'withdrawn');

  courseId = (await q("insert into courses (title, slug, fee, status) values ('퀴즈 강좌','quiz-c',0,'active') returning id"))[0].id;
  lessonId = (await q("insert into lessons (course_id, title) values ($1,'1강') returning id", [courseId]))[0].id;
  emptyLessonId = (await q("insert into lessons (course_id, title) values ($1,'2강') returning id", [courseId]))[0].id;
  for (let i = 0; i < 2; i++) {
    const qid = (await q('insert into quiz_questions (lesson_id, question, "order") values ($1,$2,$3) returning id', [lessonId, `문제${i + 1}`, 2 - i]))[0].id;
    const ok = (await q("insert into quiz_options (question_id, label, is_correct, \"order\") values ($1,'정답',true,1) returning id", [qid]))[0].id;
    const bad = (await q("insert into quiz_options (question_id, label, is_correct, \"order\") values ($1,'오답',false,2) returning id", [qid]))[0].id;
    Q.push({ id: qid, ok, bad });
  }
  const enroll = (u: string, status: string) => q('insert into enrollments (user_id, course_id, status) values ($1,$2,$3)', [users[u].id, courseId, status]);
  await enroll('learner', 'approved');
  await enroll('racer1', 'approved');
  await enroll('racer2', 'approved');
  await enroll('pending', 'pending');
  await enroll('rejected', 'rejected');
  await enroll('gone', 'approved');
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

function rpc(fn: string, args: unknown, who?: string) {
  const headers: Record<string, string> = { 'x-bara-service-key': KEY };
  if (who) headers['x-bara-session'] = users[who].token;
  return app.inject({ method: 'POST', url: `/v1/rpc/${fn}`, headers, payload: { args } as object });
}
const attempts = async (who: string) => q('select attempt_no, score from quiz_submissions where user_id = $1 order by attempt_no', [users[who].id]);

// ---------------------------------------------------------------- get_quiz_for_lesson

test('get_quiz_for_lesson: 승인된 수강생 → 문항·선택지를 순서대로, 정답 표시는 없다', async () => {
  const r = await rpc('get_quiz_for_lesson', { p_lesson_id: lessonId }, 'learner');
  expect(r.statusCode, r.body).toBe(200);
  const rows = r.json().data as Array<Record<string, unknown>>;
  expect(rows).toHaveLength(4);
  expect(Object.keys(rows[0]).sort()).toEqual(['option_id', 'option_label', 'option_order', 'question', 'question_id', 'question_order']);
  // 문제2(order 1)가 먼저, 선택지는 option order 순
  expect(rows.map((x) => [x.question, x.option_label])).toEqual([
    ['문제2', '정답'], ['문제2', '오답'], ['문제1', '정답'], ['문제1', '오답'],
  ]);
  expect(JSON.stringify(rows)).not.toContain('is_correct');
});

test('get_quiz_for_lesson: 문항이 없는 강의는 빈 배열', async () => {
  const r = await rpc('get_quiz_for_lesson', { p_lesson_id: emptyLessonId }, 'learner');
  expect(r.json()).toEqual({ data: [] });
});

test('get_quiz_for_lesson: 미신청·입금 대기·반려 회원은 not enrolled or not approved', async () => {
  for (const who of ['other', 'pending', 'rejected']) {
    const r = await rpc('get_quiz_for_lesson', { p_lesson_id: lessonId }, who);
    expect(r.statusCode, who).toBe(400);
    expect(r.json().error).toMatchObject({ code: 'db_error', message: 'not enrolled or not approved' });
  }
});

test('get_quiz_for_lesson: 비회원·탈퇴 회원은 not authorized, 없는 강의는 미승인으로 거절', async () => {
  const anon = await rpc('get_quiz_for_lesson', { p_lesson_id: lessonId });
  expect(anon.statusCode).toBe(400);
  expect(anon.json().error.message).toBe('not authorized');
  const gone = await rpc('get_quiz_for_lesson', { p_lesson_id: lessonId }, 'gone');
  expect(gone.json().error.message).toBe('not authorized');
  const nolesson = await rpc('get_quiz_for_lesson', { p_lesson_id: '00000000-0000-4000-8000-000000000000' }, 'learner');
  expect(nolesson.json().error.message).toBe('not enrolled or not approved');
});

// ---------------------------------------------------------------- submit_quiz_attempt

test('submit_quiz_attempt: 전부 정답 → 100점, 정답 id는 응답에 없다, 제출 기록 저장', async () => {
  const r = await rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: Q.map((x) => x.ok) }, 'learner');
  expect(r.statusCode, r.body).toBe(200);
  const [row] = r.json().data;
  expect(row).toMatchObject({ attempt_no: 1, score: 100, correct_count: 2, total_questions: 2 });
  expect(row.results).toEqual([
    { questionId: Q[1].id, selectedOptionId: Q[1].ok, isCorrect: true },
    { questionId: Q[0].id, selectedOptionId: Q[0].ok, isCorrect: true },
  ]);
  expect(JSON.stringify(row)).not.toContain('correctOptionId');
  expect(await attempts('learner')).toEqual([{ attempt_no: 1, score: 100 }]);
});

test('submit_quiz_attempt: 일부 오답·미응답은 오답으로 채점, 재응시는 attempt_no가 늘어난다', async () => {
  const half = await rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: [Q[0].ok, Q[1].bad] }, 'learner');
  expect(half.json().data[0]).toMatchObject({ attempt_no: 2, score: 50, correct_count: 1 });
  const none = await rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: [] }, 'learner');
  const [n] = none.json().data;
  expect(n).toMatchObject({ attempt_no: 3, score: 0, correct_count: 0 });
  expect(n.results.every((x: { selectedOptionId: string | null; isCorrect: boolean }) => x.selectedOptionId === null && x.isCorrect === false)).toBe(true);
  expect((await attempts('learner')).map((a) => a.attempt_no)).toEqual([1, 2, 3]);
});

test('submit_quiz_attempt: 다른 강의·없는 선택지 id는 무시되어 오답, 점수는 반올림', async () => {
  const r = await rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: ['00000000-0000-4000-8000-000000000000', Q[0].ok] }, 'learner');
  expect(r.json().data[0]).toMatchObject({ score: 50, correct_count: 1 });
});

test('submit_quiz_attempt: 미승인(미신청·대기·반려) → not enrolled or not approved, 기록 없음', async () => {
  for (const who of ['other', 'pending', 'rejected']) {
    const r = await rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: [Q[0].ok] }, who);
    expect(r.statusCode, who).toBe(400);
    expect(r.json().error.message).toBe('not enrolled or not approved');
    expect(await attempts(who)).toEqual([]);
  }
});

test('submit_quiz_attempt: 비회원·탈퇴 회원 not authorized, 문항 없는 강의는 quiz not found for lesson', async () => {
  expect((await rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: [] })).json().error.message).toBe('not authorized');
  expect((await rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: [] }, 'gone')).json().error.message).toBe('not authorized');
  const r = await rpc('submit_quiz_attempt', { p_lesson_id: emptyLessonId, p_selected_option_ids: [] }, 'learner');
  expect(r.json().error.message).toBe('quiz not found for lesson');
});

test('submit_quiz_attempt: 인자 형식 오류(uuid 아님·배열 아님)는 400 validation', async () => {
  const a = await rpc('submit_quiz_attempt', { p_lesson_id: 'nope', p_selected_option_ids: [] }, 'learner');
  expect(a.statusCode).toBe(400);
  const b = await rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: ['x'] }, 'learner');
  expect(b.statusCode).toBe(400);
});

test('submit_quiz_attempt: 다른 회원의 기록과 섞이지 않는다 (user별 attempt_no)', async () => {
  const r = await rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: [Q[0].ok, Q[1].ok] }, 'racer1');
  expect(r.json().data[0].attempt_no).toBe(1);
  expect(await attempts('racer2')).toEqual([]);
});

test('submit_quiz_attempt: 같은 회원이 동시에 제출해도 attempt_no가 겹치지 않는다 (1..N)', async () => {
  const rs = await Promise.all(Array.from({ length: 8 }, () => rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: [Q[0].ok] }, 'racer2')));
  expect(rs.every((r) => r.statusCode === 200)).toBe(true);
  expect((await attempts('racer2')).map((a) => a.attempt_no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(rs.map((r) => r.json().data[0].attempt_no).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});

test('submit_quiz_attempt: 다른 회원끼리 동시에 제출해도 서로 막지 않고 각자 1번부터', async () => {
  const before = (await attempts('learner')).length;
  const [a, b] = await Promise.all([
    rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: [Q[0].ok] }, 'racer1'),
    rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: [Q[0].ok] }, 'learner'),
  ]);
  expect(a.json().data[0].attempt_no).toBe(2);
  expect(b.json().data[0].attempt_no).toBe(before + 1);
});

test('submit_quiz_attempt: 한 문항에서 선택지를 둘 이상 보내면 거부하고 기록하지 않는다', async () => {
  const before = (await attempts('learner')).length;
  const r = await rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: [Q[0].ok, Q[0].bad, Q[1].ok] }, 'learner');
  expect(r.statusCode).toBe(400);
  expect(r.json().error.message).toBe('multiple options selected for one question');
  expect((await attempts('learner')).length).toBe(before);
  // 같은 선택지를 중복해서 보내는 것은 한 개로 본다
  const dup = await rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_selected_option_ids: [Q[0].ok, Q[0].ok] }, 'learner');
  expect(dup.statusCode).toBe(200);
  expect(dup.json().data[0]).toMatchObject({ correct_count: 1, total_questions: 2 });
});

test('정답이 설정되지 않은 문항은 채점 대상이 아니다: 퀴즈 조회·total_questions·results에서 일관되게 빠진다', async () => {
  const lesson = (await q("insert into lessons (course_id, title) values ($1,'3강') returning id", [courseId]))[0].id;
  const mk = async (text: string, order: number, withCorrect: boolean) => {
    const qid = (await q('insert into quiz_questions (lesson_id, question, "order") values ($1,$2,$3) returning id', [lesson, text, order]))[0].id;
    const ok = (await q('insert into quiz_options (question_id, label, is_correct, "order") values ($1,$2,$3,1) returning id', [qid, '가', withCorrect]))[0].id;
    await q("insert into quiz_options (question_id, label, is_correct, \"order\") values ($1,'나',false,2)", [qid]);
    return { qid, ok };
  };
  const graded = await mk('채점됨', 1, true);
  await mk('정답 미설정', 2, false);
  const shown = (await rpc('get_quiz_for_lesson', { p_lesson_id: lesson }, 'learner')).json().data as { question: string }[];
  expect([...new Set(shown.map((x) => x.question))]).toEqual(['채점됨']);
  const r = await rpc('submit_quiz_attempt', { p_lesson_id: lesson, p_selected_option_ids: [graded.ok] }, 'learner');
  expect(r.json().data[0]).toMatchObject({ score: 100, correct_count: 1, total_questions: 1 });
  expect(r.json().data[0].results).toHaveLength(1);
});

test('채점 가능한 문항이 하나도 없는 강의는 quiz not found for lesson', async () => {
  const lesson = (await q("insert into lessons (course_id, title) values ($1,'4강') returning id", [courseId]))[0].id;
  const qid = (await q("insert into quiz_questions (lesson_id, question) values ($1,'정답 없음') returning id", [lesson]))[0].id;
  await q("insert into quiz_options (question_id, label) values ($1,'가')", [qid]);
  const r = await rpc('submit_quiz_attempt', { p_lesson_id: lesson, p_selected_option_ids: [] }, 'learner');
  expect(r.json().error.message).toBe('quiz not found for lesson');
  expect((await rpc('get_quiz_for_lesson', { p_lesson_id: lesson }, 'learner')).json()).toEqual({ data: [] });
});

// ---------------------------------------------------------------- 진단: claim_diagnosis / get_diagnosis_summary

const ANSWERS = Object.fromEntries([...'ABCDEF'].flatMap((p) => [1, 2, 3, 4, 5].map((n) => [`${p}${n}`, 3])));
let diagN = 0; // submit_diagnosis는 같은 연락처의 짧은 시간 내 중복 제출을 막는다
async function submitDiagnosis(who?: string) {
  const r = await rpc('submit_diagnosis', {
    p_name: '진단자', p_phone: `010-1111-${String(++diagN).padStart(4, '0')}`, p_email: `d${diagN}@example.com`, p_learning_experience: 'none', p_certificate_level: 'level1',
    p_consent_privacy: true, p_consent_privacy_doc_version: 1, p_consent_sensitive: true, p_consent_sensitive_version: 'sc-v1', p_age_confirmed: true, p_answers: ANSWERS,
  }, who);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().data[0] as { access_token: string; recommended_tier: string; total_score: number };
}
const ownerOf = async (token: string) => (await q('select user_id, claimed_at from diagnosis_results where access_token = $1', [token]))[0];

test('claim_diagnosis: 미귀속 결과를 최초 1회 귀속, 본인 재호출은 멱등', async () => {
  const d = await submitDiagnosis();
  expect((await ownerOf(d.access_token)).user_id).toBeNull();
  const r = await rpc('claim_diagnosis', { p_token: d.access_token }, 'learner');
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json()).toEqual({ data: [true] });
  const after = await ownerOf(d.access_token);
  expect(after.user_id).toBe(users.learner.id);
  expect(after.claimed_at).not.toBeNull();
  const again = await rpc('claim_diagnosis', { p_token: d.access_token }, 'learner');
  expect(again.json()).toEqual({ data: [true] });
  expect((await ownerOf(d.access_token)).claimed_at).toEqual(after.claimed_at);
});

test('claim_diagnosis: 이미 다른 계정에 귀속된 결과는 거절, 소유자는 바뀌지 않는다', async () => {
  const d = await submitDiagnosis();
  await rpc('claim_diagnosis', { p_token: d.access_token }, 'learner');
  const r = await rpc('claim_diagnosis', { p_token: d.access_token }, 'other');
  expect(r.statusCode).toBe(400);
  expect(r.json().error.message).toBe('already claimed by another account');
  expect((await ownerOf(d.access_token)).user_id).toBe(users.learner.id);
});

test('claim_diagnosis: 가입 회원이 제출한 결과는 처음부터 본인 것 — 다른 회원은 귀속 불가', async () => {
  const d = await submitDiagnosis('learner');
  expect((await ownerOf(d.access_token)).user_id).toBe(users.learner.id);
  const r = await rpc('claim_diagnosis', { p_token: d.access_token }, 'other');
  expect(r.json().error.message).toBe('already claimed by another account');
});

test('claim_diagnosis: 동시에 두 계정이 귀속하면 정확히 한 명만 성공', async () => {
  const d = await submitDiagnosis();
  const [a, b] = await Promise.all([rpc('claim_diagnosis', { p_token: d.access_token }, 'racer1'), rpc('claim_diagnosis', { p_token: d.access_token }, 'racer2')]);
  expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400]);
  const winner = a.statusCode === 200 ? 'racer1' : 'racer2';
  expect((await ownerOf(d.access_token)).user_id).toBe(users[winner].id);
});

test('claim_diagnosis: 비회원은 실행 권한이 없다(403 42501), 없는 토큰은 result not found, 형식 오류 400', async () => {
  const d = await submitDiagnosis();
  const anon = await rpc('claim_diagnosis', { p_token: d.access_token });
  expect(anon.statusCode).toBe(403);
  expect(anon.json().error.sqlstate).toBe('42501');
  const nf = await rpc('claim_diagnosis', { p_token: '00000000-0000-4000-8000-000000000000' }, 'learner');
  expect(nf.json().error.message).toBe('result not found');
  expect((await rpc('claim_diagnosis', { p_token: 'nope' }, 'learner')).statusCode).toBe(400);
  expect((await ownerOf(d.access_token)).user_id).toBeNull();
});

test('get_diagnosis_summary: 비회원도 조회, 이름·연락처·영역별 점수는 응답에 없다', async () => {
  const d = await submitDiagnosis();
  const r = await rpc('get_diagnosis_summary', { p_token: d.access_token });
  expect(r.statusCode, r.body).toBe(200);
  const rows = r.json().data as Array<Record<string, unknown>>;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ recommended_tier: d.recommended_tier, total_score: d.total_score, has_owner: false, is_owned_by_caller: false });
  expect(Object.keys(rows[0]).sort()).toEqual(['course_id', 'course_slug', 'course_title', 'cta_description', 'cta_label', 'has_owner', 'is_owned_by_caller', 'recommended_tier', 'total_score']);
  const text = r.body;
  for (const secret of ['진단자', '010-1111-', '@example.com', 'score_theory']) expect(text).not.toContain(secret);
});

test('get_diagnosis_summary: 귀속 후 has_owner=true, is_owned_by_caller는 소유자에게만 true', async () => {
  const d = await submitDiagnosis();
  await rpc('claim_diagnosis', { p_token: d.access_token }, 'learner');
  const asOwner = (await rpc('get_diagnosis_summary', { p_token: d.access_token }, 'learner')).json().data[0];
  const asOther = (await rpc('get_diagnosis_summary', { p_token: d.access_token }, 'other')).json().data[0];
  const asAnon = (await rpc('get_diagnosis_summary', { p_token: d.access_token })).json().data[0];
  expect([asOwner.has_owner, asOwner.is_owned_by_caller]).toEqual([true, true]);
  expect([asOther.has_owner, asOther.is_owned_by_caller]).toEqual([true, false]);
  expect([asAnon.has_owner, asAnon.is_owned_by_caller]).toEqual([true, false]);
});

test('get_diagnosis_summary: 추천 강좌는 모집 중(active/upcoming)일 때만 연결, 닫힌 강좌는 null', async () => {
  const d = await submitDiagnosis();
  const link = async (status: string) => {
    const cid = (await q("insert into courses (title, slug, fee, status) values ('추천', $1, 0, $2) returning id", [`rec-${status}`, status]))[0].id;
    await q('update diagnosis_course_links set course_id = $2 where tier = $1', [d.recommended_tier, cid]);
    return cid;
  };
  const cid = await link('active');
  const open = (await rpc('get_diagnosis_summary', { p_token: d.access_token })).json().data[0];
  expect(open).toMatchObject({ course_id: cid, course_title: '추천' });
  await link('closed');
  const closed = (await rpc('get_diagnosis_summary', { p_token: d.access_token })).json().data[0];
  expect(closed.course_id).toBeNull();
  expect(closed.course_slug).toBeNull();
  expect(closed.cta_label).toBeTruthy();
});

test('get_diagnosis_summary: 없는 토큰은 result not found, 형식 오류는 400', async () => {
  const nf = await rpc('get_diagnosis_summary', { p_token: '00000000-0000-4000-8000-000000000000' });
  expect(nf.statusCode).toBe(400);
  expect(nf.json().error.message).toBe('result not found');
  expect((await rpc('get_diagnosis_summary', { p_token: 'x' })).statusCode).toBe(400);
});
