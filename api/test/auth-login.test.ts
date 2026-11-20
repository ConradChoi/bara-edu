import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
let n = 0;

beforeAll(async () => {
  ctx = await setupTestDb();
  const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });
  app = buildApp({ config, pool: ctx.pool, mailer: new MemoryMailer() });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});
beforeEach(async () => {
  await ctx.adminPool.query('truncate auth.rate_events');
});

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: { 'x-bara-service-key': KEY, ...headers } });

async function addUser(opts: { confirmed?: boolean; hash?: string | null; password?: string } = {}) {
  const email = `login${++n}@bara-edu.kr`;
  const hash = opts.hash === undefined ? await bcrypt.hash(opts.password ?? 'password1', 10) : opts.hash;
  await ctx.adminPool.query(
    'insert into auth.users (email, encrypted_password, email_confirmed_at) values ($1, $2, $3)',
    [email, hash, opts.confirmed === false ? null : new Date()],
  );
  return email;
}

const login = (email: string, password: string) => post('/v1/auth/login', { email, password });

test('대소문자 다른 이메일로 로그인 성공 (Review Focus 1)', async () => {
  const email = await addUser();
  const r = await login(`  ${email.toUpperCase()} `, 'password1');
  expect(r.statusCode).toBe(200);
  const b = r.json();
  expect(typeof b.sessionToken).toBe('string');
  expect(typeof b.userId).toBe('string');
  expect(new Date(b.expiresAt).getTime()).toBeGreaterThan(Date.now());
  const s = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { 'x-bara-service-key': KEY, 'x-bara-session': b.sessionToken } });
  expect(s.statusCode).toBe(200);
  expect(s.json().user.email).toBe(email);
});

test('없는 계정과 틀린 비밀번호의 응답 본문이 완전히 같다', async () => {
  const email = await addUser();
  const wrong = await login(email, 'wrong-password');
  const missing = await login('nobody@bara-edu.kr', 'wrong-password');
  expect(wrong.statusCode).toBe(401);
  expect(missing.statusCode).toBe(401);
  expect(wrong.body).toBe(missing.body);
  expect(wrong.json()).toEqual({ error: { code: 'unauthenticated', message: 'invalid_credentials' } });
});

test('미인증 계정 → 401 email_not_confirmed (비밀번호가 맞을 때만)', async () => {
  const email = await addUser({ confirmed: false });
  const r = await login(email, 'password1');
  expect(r.statusCode).toBe(401);
  expect(r.json()).toEqual({ error: { code: 'unauthenticated', message: 'email_not_confirmed' } });
  const wrong = await login(email, 'wrong-password');
  expect(wrong.json().error.message).toBe('invalid_credentials');
});

test.each([
  ['null', null],
  ['argon2', '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaGhhc2hoYXNo'],
])('해시가 %s → 401 password_reset_required, 500 아님 (Review Focus 5)', async (_name, hash) => {
  const email = await addUser({ hash });
  const r = await login(email, 'password1');
  expect(r.statusCode).toBe(401);
  expect(r.json()).toEqual({ error: { code: 'unauthenticated', message: 'password_reset_required' } });
});

test('Supabase에서 옮긴 $2a$ 해시 계정으로 로그인 성공', async () => {
  const hash = '$2a$10$' + (await bcrypt.hash('legacy-pass1', 10)).slice(7);
  expect(hash.startsWith('$2a$10$')).toBe(true);
  const email = await addUser({ hash });
  const r = await login(email, 'legacy-pass1');
  expect(r.statusCode).toBe(200);
});

test('실패 11번째 → 429 rate_limited, 올바른 비밀번호도 429', async () => {
  const email = await addUser();
  for (let i = 0; i < 10; i++) expect((await login(email, 'wrong')).statusCode).toBe(401);
  const r = await login(email, 'wrong');
  expect(r.statusCode).toBe(429);
  expect(r.json().error.code).toBe('rate_limited');
  expect((await login(email, 'password1')).statusCode).toBe(429);
});

test('실패 기록이 15분 창을 벗어나면 다시 로그인 가능', async () => {
  const email = await addUser();
  for (let i = 0; i < 10; i++) await login(email, 'wrong');
  expect((await login(email, 'password1')).statusCode).toBe(429);
  await ctx.adminPool.query("update auth.rate_events set created_at = now() - interval '16 minutes' where bucket = 'login-fail'");
  expect((await login(email, 'password1')).statusCode).toBe(200);
});

test('다른 이메일의 실패는 서로 영향 없음', async () => {
  const a = await addUser();
  const b = await addUser();
  for (let i = 0; i < 10; i++) await login(a, 'wrong');
  expect((await login(b, 'password1')).statusCode).toBe(200);
});

test('logout 뒤 같은 토큰으로 /v1/auth/session → 401', async () => {
  const email = await addUser();
  const { sessionToken } = (await login(email, 'password1')).json();
  const h = { 'x-bara-session': sessionToken };
  const out = await post('/v1/auth/logout', {}, h);
  expect(out.statusCode).toBe(200);
  expect(out.json()).toEqual({ ok: true });
  const s = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { 'x-bara-service-key': KEY, ...h } });
  expect(s.statusCode).toBe(401);
});

test('logout은 해당 세션만 폐기, 세션 없으면 401', async () => {
  const email = await addUser();
  const a = (await login(email, 'password1')).json().sessionToken;
  const b = (await login(email, 'password1')).json().sessionToken;
  await post('/v1/auth/logout', {}, { 'x-bara-session': a });
  const s = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { 'x-bara-service-key': KEY, 'x-bara-session': b } });
  expect(s.statusCode).toBe(200);
  expect((await post('/v1/auth/logout', {})).statusCode).toBe(401);
});

test('잘못된 본문 → 400', async () => {
  expect((await post('/v1/auth/login', { email: 'x' })).statusCode).toBe(400);
});
