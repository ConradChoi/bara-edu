import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
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

test('대소문자·공백만 다른 이메일로 재가입(미인증) → 같은 응답, 인증 메일 재발송', async () => {
  await signup({ email: 'User@Bara-Edu.kr ' });
  const r = await signup({ email: 'user@bara-edu.kr' });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ status: 'pending_confirmation' });
  // 신규 가입 자체는 resend 60초 카운트를 쓰지 않으므로 첫 재가입은 인증 메일을 다시 보낸다
  expect(mailer.sent).toHaveLength(2);
  expect(mailer.sent.every((m) => m.template === 'confirm')).toBe(true);
});

test('이미 인증한 계정으로 가입 → 같은 응답 + already_registered 메일(로그인 링크), 가입 정보는 그대로', async () => {
  const email = 'confirmed1@bara-edu.kr';
  await signup({ email, name: '원래이름' });
  await post('/v1/auth/verify-email', { token: tokenOf(mailer.sent[0].link) });
  mailer.sent.length = 0;
  const before = await ctx.adminPool.query('select encrypted_password from auth.users where email = $1', [email]);
  const r = await signup({ email: email.toUpperCase(), name: '다른이름', password: 'otherpass1' });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ status: 'pending_confirmation' });
  expect(mailer.sent).toEqual([{ to: email, template: 'already_registered', link: `${ORIGIN}/sign-in` }]);
  const after = await ctx.adminPool.query('select u.encrypted_password, p.name from auth.users u join public.profiles p on p.id = u.id where u.email = $1', [email]);
  expect(after.rows[0].encrypted_password).toBe(before.rows[0].encrypted_password);
  expect(after.rows[0].name).toBe('원래이름');
});

test('이미 인증한 계정에 대한 안내 메일도 60초에 한 번만 (메일 폭탄 방지), 응답은 동일', async () => {
  const email = 'confirmed2@bara-edu.kr';
  await signup({ email });
  await post('/v1/auth/verify-email', { token: tokenOf(mailer.sent[0].link) });
  mailer.sent.length = 0;
  const a = await signup({ email });
  const b = await signup({ email });
  expect(a.json()).toEqual(b.json());
  expect(mailer.sent.filter((m) => m.template === 'already_registered')).toHaveLength(1);
});

test('미인증 기존 계정으로 가입 → 같은 응답 + 인증 메일 새로 발송, 60초 안의 반복은 보내지 않는다', async () => {
  const email = 'unconfirmed1@bara-edu.kr';
  await signup({ email });
  mailer.sent.length = 0;
  const a = await signup({ email });
  expect(a.json()).toEqual({ status: 'pending_confirmation' });
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0]).toMatchObject({ to: email, template: 'confirm' });
  const b = await signup({ email });
  expect(b.json()).toEqual({ status: 'pending_confirmation' });
  expect(mailer.sent).toHaveLength(1);
  // 새 링크로 인증할 수 있다
  expect((await post('/v1/auth/verify-email', { token: tokenOf(mailer.sent[0].link) })).statusCode).toBe(200);
});

test('탈퇴(익명화)한 계정의 예전 이메일로 가입 → 새 계정으로 정상 가입', async () => {
  const email = 'left1@bara-edu.kr';
  await signup({ email });
  await ctx.adminPool.query("update auth.users set email = 'withdrawn+x@deleted.invalid' where email = $1", [email]);
  mailer.sent.length = 0;
  const r = await signup({ email });
  expect(r.json()).toEqual({ status: 'pending_confirmation' });
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0]).toMatchObject({ to: email, template: 'confirm' });
});

test('익명화된 주소(@deleted.invalid)로 가입 시도 → 같은 응답, 메일은 보내지 않는다', async () => {
  const email = 'withdrawn+11111111-1111-1111-1111-111111111111@deleted.invalid';
  await ctx.adminPool.query("insert into auth.users (email, email_confirmed_at) values ($1, now())", [email]);
  const r = await signup({ email });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ status: 'pending_confirmation' });
  expect(mailer.sent).toHaveLength(0);
});

test('가입 응답 형태는 신규/인증됨/미인증 모두 같다', async () => {
  const email = 'shape1@bara-edu.kr';
  const fresh = await signup({ email });
  const pending = await signup({ email });
  await post('/v1/auth/verify-email', { token: tokenOf(mailer.sent[0].link) });
  const confirmed = await signup({ email });
  expect(fresh.statusCode).toBe(confirmed.statusCode);
  expect(fresh.body).toBe(pending.body);
  expect(fresh.body).toBe(confirmed.body);
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
  const failApp = buildApp({ config: app.deps.config, pool: ctx.pool, mailer: failingMailer, storage: new MemoryStorage() });
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
  const failApp = buildApp({ config: app.deps.config, pool: ctx.pool, mailer: failingMailer, storage: new MemoryStorage() });
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

test('signup: client-ip 헤더가 없으면 IP 제한을 걸지 않는다', async () => {
  for (let i = 0; i < 12; i++) expect((await signup()).statusCode).toBe(200);
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

test('verify-email 성공 시 그 회원의 다른 confirm 토큰(이전 재발송분)은 모두 무효', async () => {
  await signup({ email: 'multi-confirm@bara-edu.kr' });
  const first = tokenOf(mailer.sent[0].link);
  const id = (await ctx.adminPool.query("select id from auth.users where email = 'multi-confirm@bara-edu.kr'")).rows[0].id;
  const second = await issueEmailToken(ctx.pool, id, 'confirm');
  expect((await post('/v1/auth/verify-email', { token: second })).statusCode).toBe(200);
  const again = await post('/v1/auth/verify-email', { token: first });
  expect(again.statusCode).toBe(400);
  expect(again.json().error.message).toBe('invalid_token');
});

// ---- 미인증 계정 선점 방지(2026-11-25): 미인증 계정으로 다시 가입하면 가입 입력값을 새 값으로 덮어쓴다

const login = (email: string, password: string) => post('/v1/auth/login', { email, password });
const stored = async (email: string) =>
  (await ctx.adminPool.query('select u.id, u.encrypted_password, u.raw_user_meta_data, p.name, p.phone from auth.users u join public.profiles p on p.id = u.id where u.email = $1', [email])).rows[0];

test('선점 방지: 미인증 계정 재가입 → 비밀번호·이름·연락처를 새 값으로 덮어쓰고, 새 메일의 링크로 인증하면 새 비밀번호만 통한다', async () => {
  const email = 'squat1@bara-edu.kr';
  await signup({ email, password: 'attackerpw1', name: '선점자', phone: '010-0000-0000' });
  const before = await stored(email);
  mailer.sent.length = 0;
  const r = await signup({ email, password: 'ownerpw123', name: '본인', phone: '010-9999-8888' });
  expect(r.json()).toEqual({ status: 'pending_confirmation' });
  const after = await stored(email);
  expect(after.id).toBe(before.id);
  expect(after.encrypted_password).not.toBe(before.encrypted_password);
  expect(after).toMatchObject({ name: '본인', phone: '010-9999-8888', raw_user_meta_data: { name: '본인', phone: '010-9999-8888' } });
  expect(mailer.sent).toHaveLength(1);
  expect((await post('/v1/auth/verify-email', { token: tokenOf(mailer.sent[0].link) })).statusCode).toBe(200);
  expect((await login(email, 'attackerpw1')).statusCode).toBe(401);
  expect((await login(email, 'ownerpw123')).statusCode).toBe(200);
});

test('선점 방지: 재가입에 연락처가 없으면 이전 연락처는 지워진다', async () => {
  const email = 'squat2@bara-edu.kr';
  await signup({ email, phone: '010-0000-0000' });
  await signup({ email, phone: null });
  const after = await stored(email);
  expect(after.phone).toBeNull();
  expect(after.raw_user_meta_data).toEqual({ name: '홍길동' });
});

test('선점 방지: 덮어쓰기 전에 발급된 인증 토큰(선점자가 받은 것 포함)과 세션은 무효가 된다', async () => {
  const email = 'squat3@bara-edu.kr';
  await signup({ email, password: 'attackerpw1' });
  const oldToken = tokenOf(mailer.sent[0].link);
  const { id } = await stored(email);
  const recovery = await issueEmailToken(ctx.pool, id, 'recovery');
  await ctx.adminPool.query("insert into auth.sessions (token_hash, user_id, expires_at) values ('h1', $1, now() + interval '1 day'), ('h2', $1, now() + interval '1 day')", [id]);
  mailer.sent.length = 0;
  await signup({ email, password: 'ownerpw123' });
  expect((await post('/v1/auth/verify-email', { token: oldToken })).statusCode).toBe(400);
  expect((await post('/v1/auth/reset-password', { token: recovery, newPassword: 'hijacked123' })).statusCode).toBe(400);
  expect((await ctx.adminPool.query('select count(*)::int c from auth.sessions where user_id = $1', [id])).rows[0].c).toBe(0);
  expect((await post('/v1/auth/verify-email', { token: tokenOf(mailer.sent[0].link) })).statusCode).toBe(200);
});

test('선점 방지: 60초 제한에 걸린 재가입은 덮어쓰지도, 토큰을 무효로 만들지도 않는다 (메일과 덮어쓰기는 한 묶음)', async () => {
  const email = 'squat4@bara-edu.kr';
  await signup({ email, password: 'firstpw123', name: '첫번째' });
  mailer.sent.length = 0;
  await signup({ email, password: 'secondpw12', name: '두번째' }); // 제한 안: 덮어쓰고 메일 1통
  const goodToken = tokenOf(mailer.sent[0].link);
  const snapshot = await stored(email);
  const limited = await signup({ email, password: 'thirdpw123', name: '세번째' });
  expect(limited.json()).toEqual({ status: 'pending_confirmation' });
  expect(mailer.sent).toHaveLength(1);
  expect(await stored(email)).toEqual(snapshot);
  expect((await post('/v1/auth/verify-email', { token: goodToken })).statusCode).toBe(200);
  expect((await login(email, 'secondpw12')).statusCode).toBe(200);
});

test('선점 방지: 이미 인증된 계정은 덮어쓰지 않고, 응답 형태는 같다', async () => {
  const email = 'squat5@bara-edu.kr';
  await signup({ email, password: 'ownerpw123', name: '주인' });
  await post('/v1/auth/verify-email', { token: tokenOf(mailer.sent[0].link) });
  const snapshot = await stored(email);
  const r = await signup({ email, password: 'attackerpw1', name: '공격자', phone: '010-6666-6666' });
  expect(r.json()).toEqual({ status: 'pending_confirmation' });
  expect(await stored(email)).toEqual(snapshot);
  expect((await login(email, 'ownerpw123')).statusCode).toBe(200);
});
