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
let n = 0;

beforeAll(async () => {
  ctx = await setupTestDb();
  app = buildApp({ config, pool: ctx.pool, mailer: new MemoryMailer(), storage: new MemoryStorage() });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

const q = async (sql: string, p: unknown[] = []) => (await ctx.adminPool.query(sql, p)).rows;
async function user(status: 'active' | 'withdrawn' = 'active') {
  const id = (await q('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [`ap${++n}@example.com`]))[0].id as string;
  if (status !== 'active') await q('update profiles set status = $2 where id = $1', [id, status]);
  return { id, token: (await createSession(ctx.pool, id, 30)).token };
}
async function course(seats = 2, status = 'active') {
  return (await q('insert into courses (title, slug, fee, status, seats) values ($1,$1,0,$2,$3) returning id', [`c${++n}`, status, seats]))[0].id as string;
}
const apply = async (token: string | undefined, courseId: string) => {
  const r = await app.inject({
    method: 'POST', url: '/v1/op/enrollments.apply',
    headers: { 'x-bara-service-key': KEY, ...(token ? { 'x-bara-session': token } : {}) },
    payload: { params: { courseId } },
  });
  return r;
};
const result = async (token: string, courseId: string) => {
  const r = await apply(token, courseId);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().data.result as string;
};
const rows = (uid: string, cid: string) => q('select status, payment_due_at, rejection_reason from enrollments where user_id = $1 and course_id = $2', [uid, cid]);

test('신규 신청: pending 행, 입금 기한 약 3일', async () => {
  const u = await user();
  const c = await course();
  expect(await result(u.token, c)).toBe('ok');
  const [row] = await rows(u.id, c);
  expect(row.status).toBe('pending');
  const hours = (new Date(row.payment_due_at).getTime() - Date.now()) / 3_600_000;
  expect(hours).toBeGreaterThan(71.9);
  expect(hours).toBeLessThan(72.1);
});

test('이미 승인됐거나 입금 기한이 남은 신청은 already_active, 아무것도 바뀌지 않는다', async () => {
  const u = await user();
  const c = await course();
  await result(u.token, c);
  const before = await rows(u.id, c);
  expect(await result(u.token, c)).toBe('already_active');
  expect(await rows(u.id, c)).toEqual(before);
  await q("update enrollments set status = 'approved' where user_id = $1", [u.id]);
  expect(await result(u.token, c)).toBe('already_active');
});

test.each([['rejected', '1 day'], ['pending', '-1 day'], ['expired', '1 day']])('재신청(%s, 기한 %s) → pending으로 되돌리고 기한 갱신, 반려 사유 삭제', async (status, due) => {
  const u = await user();
  const c = await course();
  await q(`insert into enrollments (user_id, course_id, status, payment_due_at, rejection_reason) values ($1,$2,$3, now() + interval '${due}', '사유')`, [u.id, c, status]);
  expect(await result(u.token, c)).toBe('ok');
  const [row] = await rows(u.id, c);
  expect(row.status).toBe('pending');
  expect(row.rejection_reason).toBeNull();
  expect(new Date(row.payment_due_at).getTime()).toBeGreaterThan(Date.now() + 71 * 3_600_000);
});

test('모집 중(active·upcoming)이 아니면 closed, 없는 강좌는 course_not_found, 탈퇴 회원은 inactive', async () => {
  const u = await user();
  expect(await result(u.token, await course(5, 'closed'))).toBe('closed');
  expect(await result(u.token, await course(5, 'upcoming'))).toBe('ok');
  expect(await result(u.token, '00000000-0000-4000-8000-000000000000')).toBe('course_not_found');
  const gone = await user('withdrawn');
  const c = await course();
  expect(await result(gone.token, c)).toBe('inactive');
  expect(await rows(gone.id, c)).toEqual([]);
});

test('정원이 승인 건수로 찼으면 full, 쓰지 않는다 (신청 대기는 자리를 잡지 않는다)', async () => {
  const c = await course(1);
  const a = await user();
  const b = await user();
  const d = await user();
  await result(a.token, c);
  await result(b.token, c); // 승인 0명이므로 둘 다 신청 가능
  await q("update enrollments set status = 'approved' where user_id = $1", [a.id]);
  expect(await result(d.token, c)).toBe('full');
  expect(await rows(d.id, c)).toEqual([]);
});

test('비회원은 401, courseId 형식 오류·추가 필드는 400', async () => {
  const c = await course();
  expect((await apply(undefined, c)).statusCode).toBe(401);
  const u = await user();
  expect((await apply(u.token, 'nope')).statusCode).toBe(400);
  const r = await app.inject({ method: 'POST', url: '/v1/op/enrollments.apply', headers: { 'x-bara-service-key': KEY, 'x-bara-session': u.token }, payload: { params: { courseId: c, userId: u.id } } });
  expect(r.statusCode).toBe(400);
});

test('동시 신청: 같은 회원이 동시에 여러 번 눌러도 행은 1개, 나머지는 already_active (unique 오류 없음)', async () => {
  const u = await user();
  const c = await course();
  const rs = await Promise.all(Array.from({ length: 6 }, () => apply(u.token, c)));
  expect(rs.every((r) => r.statusCode === 200)).toBe(true);
  const results = rs.map((r) => r.json().data.result as string).sort();
  expect(results).toEqual(['already_active', 'already_active', 'already_active', 'already_active', 'already_active', 'ok']);
  expect(await rows(u.id, c)).toHaveLength(1);
});

test('동시 신청: 여러 회원이 같은 강좌에 동시에 신청해도 모두 성공하고 중복 행이 없다', async () => {
  const c = await course(100);
  const us = await Promise.all(Array.from({ length: 8 }, () => user()));
  const rs = await Promise.all(us.map((u) => result(u.token, c)));
  expect(rs.every((x) => x === 'ok')).toBe(true);
  expect((await q('select count(*)::int c from enrollments where course_id = $1', [c]))[0].c).toBe(8);
});

test('잠금: 강좌 행이 다른 트랜잭션에 잠겨 있으면 신청은 기다렸다가, 잠금이 풀린 뒤의 값(마감)으로 판단한다', async () => {
  const c = await course(5, 'active');
  const u = await user();
  const client = await ctx.adminPool.connect();
  try {
    await client.query('begin');
    await client.query('select 1 from courses where id = $1 for update', [c]);
    let done = false;
    const pending = apply(u.token, c).then((r) => ((done = true), r));
    await new Promise((r) => setTimeout(r, 300));
    expect(done).toBe(false); // 잠금 때문에 기다린다
    await client.query("update courses set status = 'closed' where id = $1", [c]);
    await client.query('commit');
    const r = await pending;
    expect(r.json().data.result).toBe('closed');
    expect(await rows(u.id, c)).toEqual([]);
  } finally {
    client.release();
  }
});
