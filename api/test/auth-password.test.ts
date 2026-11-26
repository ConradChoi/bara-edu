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

// 가입 링크로는 세션을 얻을 수 없다: 이미 인증된 계정의 링크는 409 link_done(비밀번호가 맞아도 로그인시키지 않음)
const verifyStatus = async (token: string) => (await post('/v1/auth/signup-link/complete', { token, password: 'password1' })).statusCode;
const resetStatus = async (token: string) => (await post('/v1/auth/reset-password', { token, newPassword: 'hijacked123' })).statusCode;

test('change-password 후 남아 있던 confirm·recovery 토큰은 쓸 수 없다', async () => {
  const { id, email } = await addUser(false);
  await ctx.adminPool.query('update auth.users set email_confirmed_at = now() where id = $1', [id]);
  const confirm = await issueEmailToken(ctx.pool, id, 'confirm');
  const recovery = await issueEmailToken(ctx.pool, id, 'recovery');
  const s = await sessionOf(email);
  expect((await post('/v1/auth/change-password', { currentPassword: 'password1', newPassword: 'newpassword1' }, { 'x-bara-session': s })).statusCode).toBe(200);
  expect(await verifyStatus(confirm)).toBe(409);
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
  expect(await verifyStatus(confirm)).toBe(409);
  expect((await login(email, 'brandnew123')).statusCode).toBe(200);
});

const AT_RE = /^\d{4}년 \d{1,2}월 \d{1,2}일 (오전|오후) \d{1,2}시 \d{1,2}분$/;
const loginFailCount = async (email: string) =>
  Number((await ctx.adminPool.query("select count(*) from auth.rate_events where bucket = 'login-fail' and key = $1", [email])).rows[0].count);

test('reset-password 성공 → 그 회원의 가입 이메일로 password_changed 알림 1통(링크·비밀번호 없음, profile_changed와 같은 시각 형식)', async () => {
  const { email, id } = await addUser();
  const token = await issueEmailToken(ctx.pool, id, 'recovery');
  expect((await post('/v1/auth/reset-password', { token, newPassword: 'brandnew123' })).statusCode).toBe(200);
  expect(mailer.sent).toHaveLength(1);
  const msg = mailer.sent[0];
  expect(msg).toMatchObject({ to: email, template: 'password_changed' });
  expect(Object.keys(msg).sort()).toEqual(['at', 'template', 'to']);
  expect(msg.template === 'password_changed' && msg.at).toMatch(AT_RE);
  expect(JSON.stringify(msg)).not.toContain('brandnew123');
});

test('reset-password 실패(잘못된·이미 쓴 토큰, 규칙 위반)는 알림 메일을 보내지 않는다', async () => {
  const { id } = await addUser();
  const token = await issueEmailToken(ctx.pool, id, 'recovery');
  expect((await post('/v1/auth/reset-password', { token: 'nope', newPassword: 'brandnew123' })).statusCode).toBe(400);
  expect((await post('/v1/auth/reset-password', { token, newPassword: 'short' })).statusCode).toBe(400);
  expect(mailer.sent).toHaveLength(0);
  expect((await post('/v1/auth/reset-password', { token, newPassword: 'brandnew123' })).statusCode).toBe(200);
  mailer.sent.length = 0;
  expect((await post('/v1/auth/reset-password', { token, newPassword: 'another1234' })).statusCode).toBe(400);
  expect(mailer.sent).toHaveLength(0);
});

test('reset-password: 알림 메일 발송이 실패해도 재설정은 200이고 그대로 반영된다', async () => {
  const { email, id } = await addUser();
  const failApp = buildApp({ config: app.deps.config, pool: ctx.pool, mailer: { async send() { throw new Error('ses down'); } }, storage: new MemoryStorage() });
  const token = await issueEmailToken(ctx.pool, id, 'recovery');
  const r = await failApp.inject({ method: 'POST', url: '/v1/auth/reset-password', headers: { 'x-bara-service-key': KEY }, payload: { token, newPassword: 'brandnew123' } });
  await flushMail();
  await flushMail();
  await failApp.close();
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ ok: true });
  expect((await login(email, 'brandnew123')).statusCode).toBe(200);
});

test('reset-password: 알림 메일은 응답을 기다리지 않는다(발송이 멈춰 있어도 응답이 온다)', async () => {
  const { email, id } = await addUser();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const called: string[] = [];
  const slowApp = buildApp({ config: app.deps.config, pool: ctx.pool, mailer: { async send(m) { called.push(m.template); await gate; } }, storage: new MemoryStorage() });
  const token = await issueEmailToken(ctx.pool, id, 'recovery');
  const r = await slowApp.inject({ method: 'POST', url: '/v1/auth/reset-password', headers: { 'x-bara-service-key': KEY }, payload: { token, newPassword: 'brandnew123' } });
  expect(r.statusCode).toBe(200);
  await flushMail();
  expect(called).toEqual(['password_changed']);
  release();
  await slowApp.close();
  expect((await login(email, 'brandnew123')).statusCode).toBe(200);
});

test('reset-password 성공 → 그 이메일의 login-fail 제한 기록 삭제(대표 결정 5), 다른 이메일 기록은 그대로', async () => {
  const { email, id } = await addUser();
  const other = await addUser();
  for (let i = 0; i < 10; i++) expect((await login(email, 'wrongpass1')).statusCode).toBe(401);
  for (let i = 0; i < 3; i++) await login(other.email, 'wrongpass1');
  expect((await login(email, 'password1')).statusCode).toBe(429); // 제한에 걸림
  expect(await loginFailCount(email)).toBe(10);
  const token = await issueEmailToken(ctx.pool, id, 'recovery');
  expect((await post('/v1/auth/reset-password', { token, newPassword: 'brandnew123' })).statusCode).toBe(200);
  expect(await loginFailCount(email)).toBe(0);
  expect(await loginFailCount(other.email)).toBe(3);
  expect((await login(email, 'brandnew123')).statusCode).toBe(200);
});

test('reset-password 실패(잘못된 토큰)는 login-fail 기록을 지우지 않는다', async () => {
  const { email } = await addUser();
  for (let i = 0; i < 10; i++) await login(email, 'wrongpass1');
  expect((await post('/v1/auth/reset-password', { token: 'nope', newPassword: 'brandnew123' })).statusCode).toBe(400);
  expect(await loginFailCount(email)).toBe(10);
  expect((await login(email, 'password1')).statusCode).toBe(429);
});

test('reset-password: 대문자가 섞여 저장된 이메일(이관 계정)도 정규화 키의 login-fail 기록을 지운다', async () => {
  const stored = `Pw.Mixed${++n}@Bara-Edu.kr`;
  const key = stored.toLowerCase();
  const r = await ctx.adminPool.query<{ id: string }>(
    'insert into auth.users (email, encrypted_password, email_confirmed_at) values ($1, $2, now()) returning id',
    [stored, await bcrypt.hash('password1', 10)],
  );
  for (let i = 0; i < 10; i++) await login(key, 'wrongpass1');
  expect(await loginFailCount(key)).toBe(10);
  const token = await issueEmailToken(ctx.pool, r.rows[0].id, 'recovery');
  expect((await post('/v1/auth/reset-password', { token, newPassword: 'brandnew123' })).statusCode).toBe(200);
  expect(await loginFailCount(key)).toBe(0);
  expect((await login(key, 'brandnew123')).statusCode).toBe(200);
});

// 개인정보·보안 점검 I-3: 관리자 계정의 메일 링크 재설정은 접속 기록에 남는다
const makeAdmin = (id: string) => ctx.adminPool.query(`begin; set local session_replication_role = replica; update profiles set role='admin' where id='${id}'; commit`);
const resetLogs = async (id: string) => (await ctx.adminPool.query('select admin_id, target_user_id, action, detail, ip_address from admin_access_logs where admin_id = $1', [id])).rows;
const resetToken = async (email: string) => {
  await post('/v1/auth/request-reset', { email, origin: ORIGIN });
  return tokenOf(mailer.sent[mailer.sent.length - 1].link);
};

test('reset-password: 관리자 계정이면 접속 기록 한 줄(IP 원문 포함)', async () => {
  const { email, id } = await addUser();
  await makeAdmin(id);
  const token = await resetToken(email);
  const r = await post('/v1/auth/reset-password', { token, newPassword: 'brandnew123' }, { 'x-bara-client-ip': '2001:db8:1:2:3:4:5:6' });
  expect(r.statusCode).toBe(200);
  // 다른 관리자·운영 주소가 없으면 ;alert=self_only가 붙는다(관리자 2단계 인증 기획서 2.13)
  expect(await resetLogs(id)).toEqual([{ admin_id: id, target_user_id: id, action: '비밀번호재설정', detail: expect.stringMatching(/^재설정 메일 링크(;alert=self_only)?$/), ip_address: '2001:db8:1:2:3:4:5:6' }]);
});

test('reset-password: 관리자 + IP 헤더 없음이면 ip_address는 null', async () => {
  const { email, id } = await addUser();
  await makeAdmin(id);
  await post('/v1/auth/reset-password', { token: await resetToken(email), newPassword: 'brandnew123' });
  const rows = await resetLogs(id);
  expect(rows).toHaveLength(1);
  expect(rows[0].ip_address).toBeNull();
});

test('reset-password: 관리자 + IP 형식이 아닌 헤더면 ip_address는 null', async () => {
  const { email, id } = await addUser();
  await makeAdmin(id);
  const r = await post('/v1/auth/reset-password', { token: await resetToken(email), newPassword: 'brandnew123' }, { 'x-bara-client-ip': 'not-an-ip; drop' });
  expect(r.statusCode).toBe(200);
  const rows = await resetLogs(id);
  expect(rows).toHaveLength(1);
  expect(rows[0].ip_address).toBeNull();
});

test('reset-password: 학습자 재설정은 기록하지 않는다', async () => {
  const { email, id } = await addUser();
  const r = await post('/v1/auth/reset-password', { token: await resetToken(email), newPassword: 'brandnew123' }, { 'x-bara-client-ip': '203.0.113.9' });
  expect(r.statusCode).toBe(200);
  expect(await resetLogs(id)).toHaveLength(0);
});

test('reset-password: 잘못된 토큰이면 관리자여도 기록하지 않는다', async () => {
  const { id } = await addUser();
  await makeAdmin(id);
  const r = await post('/v1/auth/reset-password', { token: 'f'.repeat(43), newPassword: 'brandnew123' }, { 'x-bara-client-ip': '203.0.113.9' });
  expect(r.statusCode).toBe(400);
  expect(await resetLogs(id)).toHaveLength(0);
});
