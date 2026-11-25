import { afterAll, beforeAll, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { issueEmailToken } from '../src/auth/tokens.js';
import { hashPassword } from '../src/auth/passwords.js';
import { setupTestDb } from './helpers/db.js';

// 락 순서: 이메일 토큰 -> 사용자(auth.users) -> profiles. verify-email·reset-password는 토큰을 먼저 갱신한 뒤 사용자를 갱신하므로,
// 재가입 덮어쓰기·탈퇴·비밀번호 변경도 같은 순서로 잡아야 AB-BA 데드락(40P01 -> 500)이 나지 않는다.
// 테스트는 verify-email의 "토큰 갱신 -> (잠깐 멈춤) -> 사용자 갱신"을 별도 연결의 트랜잭션으로 흉내 낸다.

const KEY = 'k'.repeat(32);
const ORIGIN = 'https://bara-edu.kr';
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
let mailer: MemoryMailer;
let n = 0;

beforeAll(async () => {
  ctx = await setupTestDb();
  mailer = new MemoryMailer();
  app = buildApp({ config: loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY }), pool: ctx.pool, mailer, storage: new MemoryStorage() });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const q = async (sql: string, p: unknown[] = []) => (await ctx.adminPool.query(sql, p)).rows;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (url: string, payload: object, session?: string) =>
  app.inject({ method: 'POST', url, payload, headers: { 'x-bara-service-key': KEY, ...(session ? { 'x-bara-session': session } : {}) } });

// "토큰 갱신(락 보유) -> 다른 요청이 끼어들 시간 -> 사용자 갱신 -> 커밋"
async function verifyLike(token: string, userId: string, whileHolding: () => Promise<unknown>) {
  const c = await ctx.adminPool.connect();
  try {
    await c.query('begin');
    await c.query('update auth.email_tokens set used_at = now() where token_hash = $1', [sha(token)]);
    const other = whileHolding();
    await sleep(300);
    await c.query('update auth.users set updated_at = now(), email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1', [userId]);
    await c.query('commit');
    return await other;
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally {
    await c.query('rollback').catch(() => {});
    c.release();
  }
}

test('인증 처리 중에 같은 계정으로 재가입이 와도 데드락 없이 끝난다 (인증이 이기고 덮어쓰기는 일어나지 않는다)', async () => {
  const email = `lock${++n}@bara-edu.kr`;
  const body = { email, password: 'firstpw123', name: '본인', origin: ORIGIN };
  await post('/v1/auth/signup', body);
  const [{ id }] = await q('select id from auth.users where email = $1', [email]);
  const token = new URL(mailer.sent.at(-1)!.link).searchParams.get('token')!;
  const before = (await q('select encrypted_password from auth.users where id = $1', [id]))[0].encrypted_password;

  const r = await verifyLike(token, id, () => post('/v1/auth/signup', { ...body, password: 'secondpw12' }));
  expect(r.statusCode, r.body).toBe(200);
  const [after] = await q('select email_confirmed_at, encrypted_password from auth.users where id = $1', [id]);
  expect(after.email_confirmed_at).not.toBeNull();
  expect(after.encrypted_password).toBe(before);
});

test('인증 처리 중에 같은 계정이 탈퇴해도 데드락 없이 끝난다', async () => {
  const id = (await q('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [`lockw${++n}@example.com`]))[0].id as string;
  const session = (await createSession(ctx.pool, id, 30)).token;
  const token = await issueEmailToken(ctx.pool, id, 'recovery');
  const r = await verifyLike(token, id, () => post('/v1/account/withdraw', { reason: 'other' }, session));
  expect(r.statusCode, r.body).toBe(200);
  expect((await q('select status from profiles where id = $1', [id]))[0].status).toBe('withdrawn');
});

test('재설정 링크 처리 중에 같은 계정이 비밀번호를 바꿔도 데드락 없이 끝난다', async () => {
  const email = `lockc${++n}@example.com`;
  const id = (await q('insert into auth.users (email, email_confirmed_at, encrypted_password) values ($1, now(), $2) returning id', [email, await hashPassword('oldpassword1')]))[0].id as string;
  const session = (await createSession(ctx.pool, id, 30)).token;
  const token = await issueEmailToken(ctx.pool, id, 'recovery');
  const r = await verifyLike(token, id, () => post('/v1/auth/change-password', { currentPassword: 'oldpassword1', newPassword: 'newpassword1' }, session));
  expect(r.statusCode, r.body).toBe(200);
});

test('enrollments.apply는 프로필 행을 공유 잠금으로 읽는다 — 탈퇴 트랜잭션이 진행 중이면 기다렸다가 탈퇴 후 상태(inactive)를 본다', async () => {
  const id = (await q('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [`lockapply${++n}@example.com`]))[0].id as string;
  const session = (await createSession(ctx.pool, id, 30)).token;
  const cid = (await q("insert into courses (title, slug, fee, status, seats) values ('c','lock-c',0,'active',5) returning id"))[0].id as string;
  const c = await ctx.adminPool.connect();
  try {
    await c.query('begin');
    await c.query("update profiles set status = 'withdrawn' where id = $1", [id]); // 탈퇴 트랜잭션의 profiles 갱신(커밋 전)
    let done = false;
    const pending = post('/v1/op/enrollments.apply', { params: { courseId: cid } }, session).then((r) => ((done = true), r));
    await sleep(300);
    expect(done).toBe(false);
    await c.query('commit');
    const r = await pending;
    expect(r.json().data.result).toBe('inactive');
    expect(await q('select 1 from enrollments where user_id = $1', [id])).toHaveLength(0);
  } finally {
    await c.query('rollback').catch(() => {});
    c.release();
  }
});

test('탈퇴는 프로필 행을 먼저 잠근 뒤 진행 중 수강을 확인한다 — 그 사이에 들어온 신청(공유 잠금 보유)을 놓치지 않는다', async () => {
  const id = (await q('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [`lockwd${++n}@example.com`]))[0].id as string;
  const session = (await createSession(ctx.pool, id, 30)).token;
  const cid = (await q("insert into courses (title, slug, fee, status, seats) values ('c2','lock-c2',0,'active',5) returning id"))[0].id as string;
  const c = await ctx.adminPool.connect();
  try {
    await c.query('begin');
    await c.query('select 1 from profiles where id = $1 for share', [id]); // 신청 트랜잭션이 프로필을 읽은 상태
    let done = false;
    const pending = post('/v1/account/withdraw', { reason: 'other' }, session).then((r) => ((done = true), r));
    await sleep(300);
    expect(done).toBe(false);
    await c.query("insert into enrollments (user_id, course_id, status) values ($1, $2, 'pending')", [id, cid]);
    await c.query('commit');
    const r = await pending;
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toBe('active_enrollment');
    expect((await q('select status from profiles where id = $1', [id]))[0].status).toBe('active');
  } finally {
    await c.query('rollback').catch(() => {});
    c.release();
  }
});
