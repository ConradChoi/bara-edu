import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { issueEmailToken } from '../src/auth/tokens.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
const ORIGIN = 'https://bara-edu.kr';
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
let mailer: MemoryMailer;
let n = 0;

beforeAll(async () => {
  ctx = await setupTestDb();
  mailer = new MemoryMailer();
  const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });
  app = buildApp({ config, pool: ctx.pool, mailer });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});
beforeEach(async () => {
  mailer.sent.length = 0;
  await ctx.adminPool.query('truncate auth.rate_events');
});

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: { 'x-bara-service-key': KEY, ...headers } });

const signup = (over: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  post('/v1/auth/signup', { email: `new${++n}@bara-edu.kr`, password: 'password1', name: '홍길동', phone: '010-1234-5678', origin: ORIGIN, ...over }, headers);

const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

test('가입 → pending_confirmation, 확인 메일 1통, profiles 생성(name, phone)', async () => {
  const email = 'Signup1@Bara-Edu.kr';
  const r = await signup({ email });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ status: 'pending_confirmation' });
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0].to).toBe('signup1@bara-edu.kr');
  expect(mailer.sent[0].template).toBe('confirm');
  expect(mailer.sent[0].link.startsWith(`${ORIGIN}/auth/confirm?token=`)).toBe(true);
  const p = await ctx.adminPool.query("select p.name, p.phone, p.email, u.email_confirmed_at from auth.users u join public.profiles p on p.id = u.id where u.email = 'signup1@bara-edu.kr'");
  expect(p.rows[0]).toMatchObject({ name: '홍길동', phone: '010-1234-5678', email: 'signup1@bara-edu.kr', email_confirmed_at: null });
  const pw = await ctx.adminPool.query("select encrypted_password from auth.users where email = 'signup1@bara-edu.kr'");
  expect(pw.rows[0].encrypted_password).toMatch(/^\$2[aby]\$10\$/);
});

test('phone 생략·null 허용', async () => {
  expect((await signup({ phone: undefined })).statusCode).toBe(200);
  expect((await signup({ phone: null })).statusCode).toBe(200);
});

test('대소문자·공백만 다른 이메일로 재가입 → already_registered, 메일 없음 (Review Focus 1)', async () => {
  await signup({ email: 'User@Bara-Edu.kr ' });
  const r = await signup({ email: 'user@bara-edu.kr' });
  expect(r.json()).toEqual({ status: 'already_registered' });
  expect(mailer.sent).toHaveLength(1);
});

test('비밀번호 7자 → 400 validation, 이름 1자 → 400 validation', async () => {
  const a = await signup({ password: '1234567' });
  expect(a.statusCode).toBe(400);
  expect(a.json().error.code).toBe('validation');
  const b = await signup({ name: '가' });
  expect(b.statusCode).toBe(400);
  expect(b.json().error.code).toBe('validation');
  expect(mailer.sent).toHaveLength(0);
});

test('허용되지 않은 origin → 400', async () => {
  const r = await signup({ origin: 'https://evil.example' });
  expect(r.statusCode).toBe(400);
  expect(r.json().error.code).toBe('validation');
  expect(mailer.sent).toHaveLength(0);
});

test('메일 링크의 토큰으로 verify-email → 세션 발급, email_confirmed_at 채워짐', async () => {
  const email = 'verify1@bara-edu.kr';
  await signup({ email });
  const token = tokenOf(mailer.sent[0].link);
  const r = await post('/v1/auth/verify-email', { token });
  expect(r.statusCode).toBe(200);
  const body = r.json();
  expect(typeof body.sessionToken).toBe('string');
  expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  const u = await ctx.adminPool.query('select email_confirmed_at from auth.users where email = $1', [email]);
  expect(u.rows[0].email_confirmed_at).not.toBeNull();
  const s = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { 'x-bara-service-key': KEY, 'x-bara-session': body.sessionToken } });
  expect(s.statusCode).toBe(200);
  expect(s.json().user.email).toBe(email);
  const stored = await ctx.adminPool.query('select token_hash from auth.email_tokens');
  expect(stored.rows.some((x) => x.token_hash === token)).toBe(false);
});

test('같은 토큰 두 번째 사용 → 400 invalid_token (Review Focus 3)', async () => {
  await signup();
  const token = tokenOf(mailer.sent[0].link);
  expect((await post('/v1/auth/verify-email', { token })).statusCode).toBe(200);
  const r = await post('/v1/auth/verify-email', { token });
  expect(r.statusCode).toBe(400);
  expect(r.json()).toEqual({ error: { code: 'validation', message: 'invalid_token' } });
});

test('인증 처리가 실패하면 토큰 소모도 롤백되어 같은 토큰을 다시 쓸 수 있다', async () => {
  await signup({ email: 'atomic1@bara-edu.kr' });
  const token = tokenOf(mailer.sent[0].link);
  await ctx.adminPool.query(`create function auth.test_block_confirm() returns trigger language plpgsql as $$
    begin raise exception 'blocked'; end $$`);
  await ctx.adminPool.query(`create trigger test_block_confirm before update of email_confirmed_at on auth.users
    for each row execute function auth.test_block_confirm()`);
  try {
    const failed = await post('/v1/auth/verify-email', { token });
    expect(failed.statusCode).toBe(500);
    const row = await ctx.adminPool.query('select used_at from auth.email_tokens');
    expect(row.rows[0].used_at).toBeNull();
  } finally {
    await ctx.adminPool.query('drop trigger test_block_confirm on auth.users');
    await ctx.adminPool.query('drop function auth.test_block_confirm()');
  }
  expect((await post('/v1/auth/verify-email', { token })).statusCode).toBe(200);
});

test('만료된 토큰 → 400 invalid_token', async () => {
  await signup();
  const token = tokenOf(mailer.sent[0].link);
  await ctx.adminPool.query("update auth.email_tokens set expires_at = now() - interval '1 second'");
  const r = await post('/v1/auth/verify-email', { token });
  expect(r.statusCode).toBe(400);
  expect(r.json()).toEqual({ error: { code: 'validation', message: 'invalid_token' } });
});

test('recovery 용도 토큰으로 verify-email → 400 invalid_token', async () => {
  await signup({ email: 'rec1@bara-edu.kr' });
  const u = await ctx.adminPool.query("select id from auth.users where email = 'rec1@bara-edu.kr'");
  const token = await issueEmailToken(ctx.pool, u.rows[0].id, 'recovery');
  const r = await post('/v1/auth/verify-email', { token });
  expect(r.statusCode).toBe(400);
  expect(r.json()).toEqual({ error: { code: 'validation', message: 'invalid_token' } });
});

test('토큰 유효기간: confirm 24시간, recovery 1시간', async () => {
  await signup({ email: 'ttl1@bara-edu.kr' });
  const u = await ctx.adminPool.query("select id from auth.users where email = 'ttl1@bara-edu.kr'");
  await issueEmailToken(ctx.pool, u.rows[0].id, 'recovery');
  const r = await ctx.adminPool.query("select purpose, extract(epoch from expires_at - now()) as s from auth.email_tokens where user_id = $1", [u.rows[0].id]);
  const by = Object.fromEntries(r.rows.map((x) => [x.purpose, Number(x.s)]));
  expect(by.confirm).toBeGreaterThan(86_300);
  expect(by.confirm).toBeLessThanOrEqual(86_400);
  expect(by.recovery).toBeGreaterThan(3_500);
  expect(by.recovery).toBeLessThanOrEqual(3_600);
});

test('verify-email: 토큰 누락·과대·이상한 값 → 모두 400 invalid_token', async () => {
  const expected = { error: { code: 'validation', message: 'invalid_token' } };
  for (const payload of [{}, { token: '' }, { token: 'x'.repeat(201) }, { token: 5 }, { token: 'nope' }]) {
    const r = await post('/v1/auth/verify-email', payload);
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual(expected);
  }
});

const failingMailer = { async send() { throw new Error('smtp down'); } };

test('signup: 메일 발송 실패여도 200 pending_confirmation, 계정은 생성됨', async () => {
  const failApp = buildApp({ config: app.deps.config, pool: ctx.pool, mailer: failingMailer });
  const email = 'mailfail1@bara-edu.kr';
  const r = await failApp.inject({
    method: 'POST', url: '/v1/auth/signup', headers: { 'x-bara-service-key': KEY },
    payload: { email, password: 'password1', name: '홍길동', origin: ORIGIN },
  });
  await failApp.close();
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ status: 'pending_confirmation' });
  const u = await ctx.adminPool.query('select 1 from auth.users where email = $1', [email]);
  expect(u.rowCount).toBe(1);
});

test('resend: 메일 발송 실패여도 없는 이메일과 동일한 200 응답', async () => {
  await signup({ email: 'mailfail2@bara-edu.kr' });
  const failApp = buildApp({ config: app.deps.config, pool: ctx.pool, mailer: failingMailer });
  const call = (email: string) =>
    failApp.inject({ method: 'POST', url: '/v1/auth/resend', headers: { 'x-bara-service-key': KEY }, payload: { email, origin: ORIGIN } });
  const existing = await call('mailfail2@bara-edu.kr');
  const ghost = await call('ghost2@bara-edu.kr');
  await failApp.close();
  expect(existing.statusCode).toBe(200);
  expect(existing.statusCode).toBe(ghost.statusCode);
  expect(existing.json()).toEqual(ghost.json());
});

test('signup: IP당 1시간 10회, 11번째는 429 (x-bara-client-ip 기준)', async () => {
  const h = { 'x-bara-client-ip': '203.0.113.7' };
  for (let i = 0; i < 10; i++) expect((await signup({}, h)).statusCode).toBe(200);
  const r = await signup({}, h);
  expect(r.statusCode).toBe(429);
  expect(r.json().error.code).toBe('rate_limited');
  expect((await signup({}, { 'x-bara-client-ip': '203.0.113.8' })).statusCode).toBe(200);
});

test('signup: client-ip 헤더가 없으면 request.ip 사용', async () => {
  for (let i = 0; i < 10; i++) await signup();
  expect((await signup()).statusCode).toBe(429);
});

test('resend: 없는 이메일도 200 동일 응답, 메일 0통', async () => {
  const r = await post('/v1/auth/resend', { email: 'ghost@bara-edu.kr', origin: ORIGIN });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ status: 'pending_confirmation' });
  expect(mailer.sent).toHaveLength(0);
});

test('resend: 이미 인증된 계정은 200, 메일 0통', async () => {
  await signup({ email: 'done@bara-edu.kr' });
  await post('/v1/auth/verify-email', { token: tokenOf(mailer.sent[0].link) });
  mailer.sent.length = 0;
  const r = await post('/v1/auth/resend', { email: 'done@bara-edu.kr', origin: ORIGIN });
  expect(r.json()).toEqual({ status: 'pending_confirmation' });
  expect(mailer.sent).toHaveLength(0);
});

test('resend: 미인증 계정에 새 확인 메일, 60초 안에 두 번 → 둘 다 200, 메일은 1통', async () => {
  await signup({ email: 'pend@bara-edu.kr' });
  mailer.sent.length = 0;
  const a = await post('/v1/auth/resend', { email: ' Pend@bara-edu.kr', origin: ORIGIN });
  const b = await post('/v1/auth/resend', { email: 'pend@bara-edu.kr', origin: ORIGIN });
  expect(a.statusCode).toBe(200);
  expect(b.statusCode).toBe(200);
  expect(b.json()).toEqual(a.json());
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0].template).toBe('confirm');
});

test('resend: 1시간 4회 초과 시 200이되 메일 없음', async () => {
  await signup({ email: 'many@bara-edu.kr' });
  mailer.sent.length = 0;
  for (let i = 0; i < 6; i++) {
    await ctx.adminPool.query("update auth.rate_events set created_at = created_at - interval '61 seconds' where bucket = 'resend-60s'");
    const r = await post('/v1/auth/resend', { email: 'many@bara-edu.kr', origin: ORIGIN });
    expect(r.statusCode).toBe(200);
  }
  expect(mailer.sent).toHaveLength(4);
});

test('resend: 허용되지 않은 origin → 400', async () => {
  const r = await post('/v1/auth/resend', { email: 'x@bara-edu.kr', origin: 'https://evil.example' });
  expect(r.statusCode).toBe(400);
});
