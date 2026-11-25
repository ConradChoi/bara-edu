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
let n = 0;
let admin: string;
let learnerToken: string;

beforeAll(async () => {
  ctx = await setupTestDb();
  app = buildApp({ config: loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY }), pool: ctx.pool, mailer: new MemoryMailer(), storage: new MemoryStorage() });
  await app.ready();
  const a = (await ctx.adminPool.query("insert into auth.users (email, email_confirmed_at) values ('adm@example.com', now()) returning id")).rows[0].id;
  // role 보호 트리거를 피해 관리자로 만든다
  await ctx.adminPool.query(`begin; set local session_replication_role = replica; update profiles set role='admin' where id='${a}'; commit`);
  admin = (await createSession(ctx.pool, a, 30)).token;
  const l = (await ctx.adminPool.query("insert into auth.users (email, email_confirmed_at) values ('lrn@example.com', now()) returning id")).rows[0].id;
  learnerToken = (await createSession(ctx.pool, l, 30)).token;
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

const q = async (sql: string, p: unknown[] = []) => (await ctx.adminPool.query(sql, p)).rows;
const course = async (seats: number) => (await q('insert into courses (title, slug, fee, status, seats) values ($1,$1,0,$2,$3) returning id', [`ap${++n}`, 'active', seats]))[0].id as string;
async function pending(courseId: string, status = 'pending') {
  const u = (await q('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [`m${++n}@example.com`]))[0].id as string;
  return (await q('insert into enrollments (user_id, course_id, status) values ($1,$2,$3) returning id', [u, courseId, status]))[0].id as string;
}
const approve = (token: string | undefined, enrollmentId: string) =>
  app.inject({
    method: 'POST', url: '/v1/op/enrollments.approve',
    headers: { 'x-bara-service-key': KEY, ...(token ? { 'x-bara-session': token } : {}) },
    payload: { params: { enrollmentId } },
  });
const result = async (token: string, id: string) => {
  const r = await approve(token, id);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().data.result as string;
};
const status = async (id: string) => (await q('select status, approved_at, rejection_reason from enrollments where id = $1', [id]))[0];

test('승인: pending → approved, approved_at 기록, 반려 사유 삭제', async () => {
  const c = await course(3);
  const e = await pending(c);
  await q("update enrollments set rejection_reason = '예전 사유' where id = $1", [e]);
  expect(await result(admin, e)).toBe('ok');
  const row = await status(e);
  expect(row.status).toBe('approved');
  expect(row.approved_at).not.toBeNull();
  expect(row.rejection_reason).toBeNull();
});

test('정원이 승인 건수로 찼으면 full, 상태는 그대로', async () => {
  const c = await course(2);
  const [a, b, d] = [await pending(c), await pending(c), await pending(c)];
  expect(await result(admin, a)).toBe('ok');
  expect(await result(admin, b)).toBe('ok');
  expect(await result(admin, d)).toBe('full');
  expect((await status(d)).status).toBe('pending');
  // 승인 취소로 자리가 나면 다시 승인할 수 있다
  await q("update enrollments set status = 'rejected' where id = $1", [a]);
  expect(await result(admin, d)).toBe('ok');
});

test('정원 0(seats는 NOT NULL, 기본 0)인 강좌는 승인할 수 없다 — 기존 화면의 "정원 마감" 판단과 같다', async () => {
  const c = await course(0);
  const e = await pending(c);
  expect(await result(admin, e)).toBe('full');
});

test('이미 처리된 신청(승인·반려)은 already_processed, 없는 신청은 not_found', async () => {
  const c = await course(5);
  const approved = await pending(c, 'approved');
  const rejected = await pending(c, 'rejected');
  expect(await result(admin, approved)).toBe('already_processed');
  expect(await result(admin, rejected)).toBe('already_processed');
  expect(await result(admin, '00000000-0000-4000-8000-000000000000')).toBe('not_found');
});

test('동시 승인: 자리가 1개 남았을 때 두 건을 동시에 승인하면 하나만 성공하고 정원을 넘지 않는다', async () => {
  const c = await course(1);
  const ids = await Promise.all(Array.from({ length: 5 }, () => pending(c)));
  const results = await Promise.all(ids.map((id) => result(admin, id)));
  expect(results.filter((r) => r === 'ok')).toHaveLength(1);
  expect(results.filter((r) => r === 'full')).toHaveLength(4);
  expect((await q("select count(*)::int n from enrollments where course_id = $1 and status = 'approved'", [c]))[0].n).toBe(1);
});

test('같은 신청을 동시에 두 번 승인해도 한 번만 성공', async () => {
  const c = await course(5);
  const e = await pending(c);
  const rs = await Promise.all([result(admin, e), result(admin, e), result(admin, e)]);
  expect(rs.sort()).toEqual(['already_processed', 'already_processed', 'ok']);
});

test('관리자가 아니면 forbidden(변경 없음), 비회원은 401, 형식 오류는 400', async () => {
  const c = await course(5);
  const e = await pending(c);
  expect(await result(learnerToken, e)).toBe('forbidden');
  expect((await status(e)).status).toBe('pending');
  expect((await approve(undefined, e)).statusCode).toBe(401);
  expect((await approve(admin, 'nope')).statusCode).toBe(400);
});
