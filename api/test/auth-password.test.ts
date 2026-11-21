import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStorage } from '../src/storage/storage.js';
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
  app = buildApp({ config, pool: ctx.pool, mailer, storage: new MemoryStorage() });
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

const flushMail = () => new Promise<void>((r) => setImmediate(r));

const post = async (url: string, payload: unknown, headers: Record<string, string> = {}) => {
  const res = await app.inject({ method: 'POST', url, payload: payload as object, headers: { 'x-bara-service-key': KEY, ...headers } });
  await flushMail();
  return res;
};

async function addUser(confirmed = true) {
  const email = `pw${++n}@bara-edu.kr`;
  const r = await ctx.adminPool.query<{ id: string }>(
    'insert into auth.users (email, encrypted_password, email_confirmed_at) values ($1, $2, $3) returning id',
    [email, await bcrypt.hash('password1', 10), confirmed ? new Date() : null],
  );
  return { email, id: r.rows[0].id };
}
const login = async (email: string, password: string) => post('/v1/auth/login', { email, password });
const sessionOf = async (email: string, password = 'password1') => (await login(email, password)).json().sessionToken as string;
const sessionStatus = async (token: string) =>
  (await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { 'x-bara-service-key': KEY, 'x-bara-session': token } })).statusCode;
const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

test('change-password: 현재 비밀번호 틀리면 403, 맞으면 새 비밀번호로 로그인됨', async () => {
  const { email } = await addUser();
  const s = await sessionOf(email);
  const bad = await post('/v1/auth/change-password', { currentPassword: 'nope-nope', newPassword: 'newpassword1' }, { 'x-bara-session': s });
  expect(bad.statusCode).toBe(403);
  expect(bad.json().error.code).toBe('forbidden');
  expect((await login(email, 'password1')).statusCode).toBe(200);
  const ok = await post('/v1/auth/change-password', { currentPassword: 'password1', newPassword: 'newpassword1' }, { 'x-bara-session': s });
  expect(ok.statusCode).toBe(200);
  expect(ok.json()).toEqual({ ok: true });
  expect((await login(email, 'newpassword1')).statusCode).toBe(200);
  expect((await login(email, 'password1')).statusCode).toBe(401);
});

test('change-password 성공 시 다른 기기 세션은 401, 현재 세션은 유지', async () => {
  const { email } = await addUser();
  const current = await sessionOf(email);
  const other = await sessionOf(email);
  await post('/v1/auth/change-password', { currentPassword: 'password1', newPassword: 'newpassword1' }, { 'x-bara-session': current });
  expect(await sessionStatus(other)).toBe(401);
  expect(await sessionStatus(current)).toBe(200);
});

test('change-password: 세션 없으면 401, 새 비밀번호 7자면 400', async () => {
  const { email } = await addUser();
  expect((await post('/v1/auth/change-password', { currentPassword: 'password1', newPassword: 'newpassword1' })).statusCode).toBe(401);
  const s = await sessionOf(email);
  const r = await post('/v1/auth/change-password', { currentPassword: 'password1', newPassword: '1234567' }, { 'x-bara-session': s });
  expect(r.statusCode).toBe(400);
});

test('request-reset: 없는 이메일도 200, 메일 0통', async () => {
  const r = await post('/v1/auth/request-reset', { email: 'ghost@bara-edu.kr', origin: ORIGIN });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ ok: true });
  expect(mailer.sent).toHaveLength(0);
});

test('request-reset: 계정이 있으면 recovery 메일 1통, 링크 형식', async () => {
  const { email } = await addUser();
  const r = await post('/v1/auth/request-reset', { email: email.toUpperCase(), origin: ORIGIN });
  expect(r.json()).toEqual({ ok: true });
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0]).toMatchObject({ to: email, template: 'recovery' });
  expect(mailer.sent[0].link.startsWith(`${ORIGIN}/reset-password?token=`)).toBe(true);
});

test('request-reset: 같은 이메일 60초 내 재요청은 200이지만 메일 추가 없음, 허용 안 된 origin은 400', async () => {
  const { email } = await addUser();
  await post('/v1/auth/request-reset', { email, origin: ORIGIN });
  const again = await post('/v1/auth/request-reset', { email, origin: ORIGIN });
  expect(again.statusCode).toBe(200);
  expect(mailer.sent).toHaveLength(1);
  expect((await post('/v1/auth/request-reset', { email, origin: 'https://evil.example' })).statusCode).toBe(400);
});

test('reset-password 성공 → 기존 세션 전부 폐기, 새 비밀번호 로그인, 토큰 재사용 불가', async () => {
  const { email } = await addUser();
  const s1 = await sessionOf(email);
  const s2 = await sessionOf(email);
  await post('/v1/auth/request-reset', { email, origin: ORIGIN });
  const token = tokenOf(mailer.sent[0].link);
  const r = await post('/v1/auth/reset-password', { token, newPassword: 'brandnew123' });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ ok: true });
  expect(await sessionStatus(s1)).toBe(401);
  expect(await sessionStatus(s2)).toBe(401);
  expect((await login(email, 'brandnew123')).statusCode).toBe(200);
  expect((await login(email, 'password1')).statusCode).toBe(401);
  const reuse = await post('/v1/auth/reset-password', { token, newPassword: 'another1234' });
  expect(reuse.statusCode).toBe(400);
  expect(reuse.json()).toEqual({ error: { code: 'validation', message: 'invalid_token' } });
});

test('reset-password: 미인증 계정이면 email_confirmed_at을 채움', async () => {
  const { email, id } = await addUser(false);
  await post('/v1/auth/request-reset', { email, origin: ORIGIN });
  await post('/v1/auth/reset-password', { token: tokenOf(mailer.sent[0].link), newPassword: 'brandnew123' });
  const r = await ctx.adminPool.query('select email_confirmed_at from auth.users where id = $1', [id]);
  expect(r.rows[0].email_confirmed_at).not.toBeNull();
  expect((await login(email, 'brandnew123')).statusCode).toBe(200);
});

test('confirm 용도 토큰으로 reset-password → 400 invalid_token (Review Focus 3)', async () => {
  const { id, email } = await addUser(false);
  const token = await issueEmailToken(ctx.pool, id, 'confirm');
  const r = await post('/v1/auth/reset-password', { token, newPassword: 'brandnew123' });
  expect(r.statusCode).toBe(400);
  expect(r.json()).toEqual({ error: { code: 'validation', message: 'invalid_token' } });
  const u = await ctx.adminPool.query('select email_confirmed_at from auth.users where id = $1', [id]);
  expect(u.rows[0].email_confirmed_at).toBeNull();
  expect((await login(email, 'password1')).statusCode).toBe(401);
});

test('만료된 recovery 토큰 → 400 invalid_token', async () => {
  const { id } = await addUser();
  const token = await issueEmailToken(ctx.pool, id, 'recovery');
  await ctx.adminPool.query("update auth.email_tokens set expires_at = now() - interval '1 second' where user_id = $1", [id]);
  const r = await post('/v1/auth/reset-password', { token, newPassword: 'brandnew123' });
  expect(r.statusCode).toBe(400);
  expect(r.json().error.message).toBe('invalid_token');
});

test('새 비밀번호 7자 → 400, 토큰은 소모되지 않아 이후 재시도 가능', async () => {
  const { id, email } = await addUser();
  const token = await issueEmailToken(ctx.pool, id, 'recovery');
  const r = await post('/v1/auth/reset-password', { token, newPassword: '1234567' });
  expect(r.statusCode).toBe(400);
  expect(r.json().error.code).toBe('validation');
  expect((await post('/v1/auth/reset-password', { token, newPassword: 'brandnew123' })).statusCode).toBe(200);
  expect((await login(email, 'brandnew123')).statusCode).toBe(200);
});

const verifyStatus = async (token: string) => (await post('/v1/auth/verify-email', { token })).statusCode;
const resetStatus = async (token: string) => (await post('/v1/auth/reset-password', { token, newPassword: 'hijacked123' })).statusCode;

test('change-password 후 남아 있던 confirm·recovery 토큰은 쓸 수 없다', async () => {
  const { id, email } = await addUser(false);
  await ctx.adminPool.query('update auth.users set email_confirmed_at = now() where id = $1', [id]);
  const confirm = await issueEmailToken(ctx.pool, id, 'confirm');
  const recovery = await issueEmailToken(ctx.pool, id, 'recovery');
  const s = await sessionOf(email);
  expect((await post('/v1/auth/change-password', { currentPassword: 'password1', newPassword: 'newpassword1' }, { 'x-bara-session': s })).statusCode).toBe(200);
  expect(await verifyStatus(confirm)).toBe(400);
  expect(await resetStatus(recovery)).toBe(400);
  expect((await login(email, 'newpassword1')).statusCode).toBe(200);
});

test('reset-password 성공 시 그 회원의 다른 recovery·confirm 토큰도 무효', async () => {
  const { id, email } = await addUser();
  const used = await issueEmailToken(ctx.pool, id, 'recovery');
  const otherRecovery = await issueEmailToken(ctx.pool, id, 'recovery');
  const confirm = await issueEmailToken(ctx.pool, id, 'confirm');
  expect((await post('/v1/auth/reset-password', { token: used, newPassword: 'brandnew123' })).statusCode).toBe(200);
  expect(await resetStatus(otherRecovery)).toBe(400);
  expect(await verifyStatus(confirm)).toBe(400);
  expect((await login(email, 'brandnew123')).statusCode).toBe(200);
});
