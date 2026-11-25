import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
const ORIGIN = 'https://bara-edu.kr';
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
let session: string;

beforeAll(async () => {
  ctx = await setupTestDb();
  app = buildApp({ config: loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY }), pool: ctx.pool, mailer: new MemoryMailer(), storage: new MemoryStorage() });
  await app.ready();
  const id = (await ctx.adminPool.query("insert into auth.users (email, email_confirmed_at) values ('f@example.com', now()) returning id")).rows[0].id;
  session = (await createSession(ctx.pool, id, 30)).token;
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

const post = (url: string, payload: unknown, withSession = false) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: { 'x-bara-service-key': KEY, ...(withSession ? { 'x-bara-session': session } : {}) } });
const good = { email: 'ok@bara-edu.kr', password: 'password1', name: '홍길동', origin: ORIGIN };

test.each([
  ['email', { email: 'not-an-email' }],
  ['email', { email: '한글@bara-edu.kr' }],
  ['email', { email: `${'a'.repeat(250)}@bara-edu.kr` }],
  ['password', { password: '1234567' }],
  ['password', { password: 'x'.repeat(201) }],
  ['name', { name: '가' }],
  ['name', { name: '가'.repeat(101) }],
  ['phone', { phone: '0'.repeat(31) }],
])('가입 400: %s 칸 문제 → error.field', async (field, over) => {
  const r = await post('/v1/auth/signup', { ...good, ...over });
  expect(r.statusCode).toBe(400);
  expect(r.json().error).toMatchObject({ code: 'validation', field });
});

test('가입 400: 여러 칸이 틀리면 첫 번째 칸(스키마 순서)만 알려 준다', async () => {
  const r = await post('/v1/auth/signup', { ...good, email: 'bad', password: '1' });
  expect(r.json().error.field).toBe('email');
});

test('가입 400: 형식 오류가 아닌 요청(본문 없음·허용되지 않은 origin)은 field가 없거나 origin', async () => {
  const empty = await post('/v1/auth/signup', undefined);
  expect(empty.statusCode).toBe(400);
  expect(empty.json().error.field).toBeUndefined();
  const origin = await post('/v1/auth/signup', { ...good, origin: 'https://evil.example' });
  expect(origin.statusCode).toBe(400);
  expect(origin.json().error.field).toBe('origin');
});

test('재전송·재설정 요청 400: email', async () => {
  for (const url of ['/v1/auth/resend', '/v1/auth/request-reset']) {
    const r = await post(url, { email: 'bad', origin: ORIGIN });
    expect(r.statusCode, url).toBe(400);
    expect(r.json().error.field, url).toBe('email');
  }
});

test('로그인 400: email, password(200자 초과·빈 값)', async () => {
  expect((await post('/v1/auth/login', { email: 'bad', password: 'x' })).json().error.field).toBe('email');
  expect((await post('/v1/auth/login', { email: 'a@bara-edu.kr', password: 'x'.repeat(201) })).json().error.field).toBe('password');
  expect((await post('/v1/auth/login', { email: 'a@bara-edu.kr', password: '' })).json().error.field).toBe('password');
});

test('비밀번호 재설정·변경 400: 새 비밀번호는 password, 현재 비밀번호는 currentPassword, 토큰은 token', async () => {
  const reset = await post('/v1/auth/reset-password', { token: 't', newPassword: 'short' });
  expect(reset.json().error.field).toBe('password');
  expect((await post('/v1/auth/reset-password', { token: '', newPassword: 'longenough1' })).json().error.field).toBe('token');
  const change = await post('/v1/auth/change-password', { currentPassword: 'x', newPassword: 'short' }, true);
  expect(change.statusCode).toBe(400);
  expect(change.json().error.field).toBe('password');
  expect((await post('/v1/auth/change-password', { currentPassword: '', newPassword: 'longenough1' }, true)).json().error.field).toBe('currentPassword');
});

test('field는 400 validation에만 붙고, 다른 오류 응답 형태는 그대로다', async () => {
  const unauth = await post('/v1/auth/change-password', { currentPassword: 'x', newPassword: 'longenough1' });
  expect(unauth.statusCode).toBe(401);
  expect(unauth.json()).toEqual({ error: { code: 'unauthenticated', message: '로그인이 필요합니다.' } });
  const tok = await post('/v1/auth/signup-link/complete', { token: 'nope', password: 'x' });
  expect(tok.json()).toEqual({ error: { code: 'validation', message: 'invalid_token' } });
});
