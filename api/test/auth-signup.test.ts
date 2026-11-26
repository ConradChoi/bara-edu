import { createHash } from 'node:crypto';
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
const checkState = async (token: string) =>
  (await app.inject({ method: 'GET', url: '/v1/auth/signup-link/check', headers: { 'x-bara-service-key': KEY, 'x-bara-signup-token': token } })).json().state as string;
const confirm = (token: string, password = 'password1') => post('/v1/auth/signup-link/complete', { token, password });

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
  expect(pw.rows[0].encrypted_password).toBeNull(); // 비밀번호는 가입 시도에만 있다
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
  await confirm(tokenOf(mailer.sent[0].link));
  mailer.sent.length = 0;
  const before = await ctx.adminPool.query('select encrypted_password from auth.users where email = $1', [email]);
  const r = await signup({ email: email.toUpperCase(), name: '다른이름', password: 'otherpass1' });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ status: 'pending_confirmation' });
  expect(mailer.sent).toEqual([{ to: email, template: 'already_registered', link: `${ORIGIN}/sign-in`, forgotLink: `${ORIGIN}/forgot-password` }]);
  const after = await ctx.adminPool.query('select u.encrypted_password, p.name from auth.users u join public.profiles p on p.id = u.id where u.email = $1', [email]);
  expect(after.rows[0].encrypted_password).toBe(before.rows[0].encrypted_password);
  expect(after.rows[0].name).toBe('원래이름');
});

test('이미 인증한 계정에 대한 안내 메일도 60초에 한 번만 (메일 폭탄 방지), 응답은 동일', async () => {
  const email = 'confirmed2@bara-edu.kr';
  await signup({ email });
  await confirm(tokenOf(mailer.sent[0].link));
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
  expect((await confirm(tokenOf(mailer.sent[0].link))).statusCode).toBe(200);
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
  await confirm(tokenOf(mailer.sent[0].link));
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

test('메일 링크의 토큰 + 가입 때 비밀번호로 complete → 세션 발급, email_confirmed_at·비밀번호 채워짐, 시도는 삭제', async () => {
  const email = 'verify1@bara-edu.kr';
  await signup({ email });
  const token = tokenOf(mailer.sent[0].link);
  const r = await confirm(token);
  expect(r.statusCode).toBe(200);
  const body = r.json();
  expect(typeof body.sessionToken).toBe('string');
  expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  const u = await ctx.adminPool.query('select email_confirmed_at, encrypted_password from auth.users where email = $1', [email]);
  expect(u.rows[0].email_confirmed_at).not.toBeNull();
  expect(u.rows[0].encrypted_password).toMatch(/^\$2[aby]\$10\$/);
  expect(await attemptsOf(email)).toHaveLength(0);
  const s = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { 'x-bara-service-key': KEY, 'x-bara-session': body.sessionToken } });
  expect(s.statusCode).toBe(200);
  expect(s.json().user.email).toBe(email);
  const stored = await ctx.adminPool.query('select token_hash from auth.email_tokens');
  expect(stored.rows.some((x) => x.token_hash === token)).toBe(false);
  expect((await login(email, 'password1')).statusCode).toBe(200);
});

test('같은 토큰 두 번째 사용 → 409 link_done', async () => {
  await signup();
  const token = tokenOf(mailer.sent[0].link);
  expect((await confirm(token)).statusCode).toBe(200);
  const r = await confirm(token);
  expect(r.statusCode).toBe(409);
  expect(r.json()).toEqual({ error: { code: 'conflict', message: 'link_done' } });
});

test('확정 트랜잭션이 실패하면 전부 롤백되어 같은 토큰으로 다시 확정할 수 있다 (비교 횟수 예약만 남는다)', async () => {
  await signup({ email: 'atomic1@bara-edu.kr' });
  const token = tokenOf(mailer.sent[0].link);
  await ctx.adminPool.query(`create function auth.test_block_confirm() returns trigger language plpgsql as $$
    begin raise exception 'blocked'; end $$`);
  await ctx.adminPool.query(`create trigger test_block_confirm before update of email_confirmed_at on auth.users
    for each row execute function auth.test_block_confirm()`);
  try {
    const failed = await confirm(token);
    expect(failed.statusCode).toBe(500);
    expect((await ctx.adminPool.query('select used_at from auth.email_tokens where token_hash = $1', [createHash('sha256').update(token).digest('hex')])).rows[0].used_at).toBeNull();
    expect(await attemptsOf('atomic1@bara-edu.kr')).toHaveLength(1);
    expect((await ctx.adminPool.query("select email_confirmed_at from auth.users where email = 'atomic1@bara-edu.kr'")).rows[0].email_confirmed_at).toBeNull();
  } finally {
    await ctx.adminPool.query('drop trigger test_block_confirm on auth.users');
    await ctx.adminPool.query('drop function auth.test_block_confirm()');
  }
  expect((await confirm(token)).statusCode).toBe(200);
});

test('만료된 토큰 → 409 link_expired (비밀번호는 비교하지 않는다)', async () => {
  await signup();
  const token = tokenOf(mailer.sent[0].link);
  await ctx.adminPool.query("update auth.email_tokens set expires_at = now() - interval '1 second'");
  const r = await confirm(token);
  expect(r.statusCode).toBe(409);
  expect(r.json()).toEqual({ error: { code: 'conflict', message: 'link_expired' } });
  expect((await ctx.adminPool.query('select a.fail_count from auth.signup_attempts a join auth.email_tokens t on t.attempt_id = a.id where t.token_hash = $1', [createHash('sha256').update(token).digest('hex')])).rows[0].fail_count).toBe(0);
});

test('recovery 용도 토큰으로 complete → 400 invalid_token', async () => {
  await signup({ email: 'rec1@bara-edu.kr' });
  const u = await ctx.adminPool.query("select id from auth.users where email = 'rec1@bara-edu.kr'");
  const token = await issueEmailToken(ctx.pool, u.rows[0].id, 'recovery');
  const r = await confirm(token);
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

test('옛 verify-email 경로는 없다 (404)', async () => {
  expect((await post('/v1/auth/verify-email', { token: 'x' })).statusCode).toBe(404);
});

test('complete: 모르는 토큰 → 400 invalid_token, 본문 형식 오류 → 400 validation + field', async () => {
  const unknown = await confirm('nope');
  expect(unknown.statusCode).toBe(400);
  expect(unknown.json()).toEqual({ error: { code: 'validation', message: 'invalid_token' } });
  for (const [payload, field] of [[{ password: 'x' }, 'token'], [{ token: '' , password: 'x' }, 'token'], [{ token: 'x'.repeat(201), password: 'x' }, 'token'], [{ token: 'x' }, 'password'], [{ token: 'x', password: '' }, 'password']] as const) {
    const r = await post('/v1/auth/signup-link/complete', payload);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatchObject({ code: 'validation', field });
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
  await confirm(tokenOf(mailer.sent[0].link));
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

test('확정 성공 시 그 회원의 다른 confirm 토큰(이전 재발송분)은 모두 무효(link_done)', async () => {
  await signup({ email: 'multi-confirm@bara-edu.kr' });
  const first = tokenOf(mailer.sent[0].link);
  mailer.sent.length = 0;
  await ctx.adminPool.query('truncate auth.rate_events');
  await post('/v1/auth/resend', { email: 'multi-confirm@bara-edu.kr', origin: ORIGIN });
  const second = tokenOf(mailer.sent[0].link);
  expect(second).not.toBe(first);
  expect((await confirm(second)).statusCode).toBe(200);
  const again = await confirm(first);
  expect(again.statusCode).toBe(409);
  expect(again.json().error.message).toBe('link_done');
});

// ---- 미인증 계정 선점 방지(2026-11-25, 가입 시도 방식): 미인증 계정으로 다시 가입하면 시도만 추가하고, 링크는 각자 자기 시도의 비밀번호로만 열린다

const login = (email: string, password: string) => post('/v1/auth/login', { email, password });
const stored = async (email: string) =>
  (await ctx.adminPool.query('select u.id, u.encrypted_password, u.raw_user_meta_data, u.email_confirmed_at, p.name, p.phone from auth.users u join public.profiles p on p.id = u.id where u.email = $1', [email])).rows[0];
const attemptsOf = async (email: string) =>
  (await ctx.adminPool.query('select a.* from auth.signup_attempts a join auth.users u on u.id = a.user_id where u.email = $1 order by a.created_at, a.id', [email])).rows;
const resetLimits = () => ctx.adminPool.query('truncate auth.rate_events');

test('가입: 계정의 encrypted_password는 비어 있고, 비밀번호 해시·이름·연락처는 가입 시도에 있다 (만료 7일)', async () => {
  const email = 'attempt1@bara-edu.kr';
  await signup({ email, password: 'victimpw123', name: '본인', phone: '010-1111-2222' });
  const u = await stored(email);
  expect(u.encrypted_password).toBeNull();
  const [a] = await attemptsOf(email);
  expect(a).toMatchObject({ name: '본인', phone: '010-1111-2222', fail_count: 0, locked_at: null });
  expect(a.password_hash).toMatch(/^\$2[aby]\$10\$/);
  const days = (new Date(a.expires_at).getTime() - new Date(a.created_at).getTime()) / 86_400_000;
  expect(days).toBeCloseTo(7, 1);
  const t = (await ctx.adminPool.query('select attempt_id from auth.email_tokens where user_id = $1', [u.id])).rows;
  expect(t).toEqual([{ attempt_id: a.id }]);
});

test('선점 방지: 공격자가 같은 이메일로 재가입해도 계정 행·프로필은 그대로, 시도만 추가된다. 피해자는 자기 비밀번호로만 확정하고, 공격자 비밀번호는 통하지 않는다', async () => {
  const email = 'squat1@bara-edu.kr';
  await signup({ email, password: 'victimpw123', name: '본인', phone: '010-9999-8888' });
  const linkA = tokenOf(mailer.sent[0].link);
  const before = await stored(email);
  await resetLimits();
  const r = await signup({ email, password: 'attackerpw1', name: '선점자', phone: '010-0000-0000' });
  expect(r.json()).toEqual({ status: 'pending_confirmation' });
  expect(mailer.sent).toHaveLength(2);
  const linkB = tokenOf(mailer.sent[1].link); // 공격자가 넣은 비밀번호의 링크 — 메일은 피해자에게 간다
  expect(await stored(email)).toEqual(before);
  expect(await attemptsOf(email)).toHaveLength(2);
  // 링크 A는 재가입 뒤에도 살아 있다
  expect(await checkState(linkA)).toBe('ready');
  // 피해자가 최신 메일(B)을 눌러도 자기 비밀번호로는 열리지 않는다
  const wrong = await confirm(linkB, 'victimpw123');
  expect(wrong.statusCode).toBe(403);
  expect(wrong.json().error).toEqual({ code: 'forbidden', message: 'wrong_password', attemptsLeft: 4 });
  expect((await stored(email)).email_confirmed_at).toBeNull();
  // 이전 메일(A)을 눌러 자기 비밀번호를 넣으면 확정된다
  expect((await confirm(linkA, 'victimpw123')).statusCode).toBe(200);
  const done = await stored(email);
  expect(done).toMatchObject({ name: '본인', phone: '010-9999-8888', raw_user_meta_data: { name: '본인', phone: '010-9999-8888' } });
  expect(done.email_confirmed_at).not.toBeNull();
  // 확정되면 다른 시도·링크는 모두 무효
  expect(await attemptsOf(email)).toHaveLength(0);
  expect(await checkState(linkB)).toBe('done');
  expect((await confirm(linkB, 'attackerpw1')).statusCode).toBe(409);
  expect((await login(email, 'attackerpw1')).statusCode).toBe(401);
  expect((await login(email, 'victimpw123')).statusCode).toBe(200);
});

test('선점 방지: 선점자가 먼저, 본인이 나중에 가입하면 본인 링크로 확정하고 프로필은 본인 값이 된다 (링크를 연 사람의 시도가 이긴다)', async () => {
  const email = 'squat2@bara-edu.kr';
  await signup({ email, password: 'attackerpw1', name: '선점자', phone: '010-0000-0000' });
  expect((await stored(email)).name).toBe('선점자'); // 첫 가입 값이 프로필에 들어 있다(확정 전)
  await resetLimits();
  await signup({ email, password: 'ownerpw123', name: '본인', phone: null });
  const own = tokenOf(mailer.sent.at(-1)!.link);
  expect((await confirm(own, 'ownerpw123')).statusCode).toBe(200);
  const after = await stored(email);
  expect(after).toMatchObject({ name: '본인', phone: null, raw_user_meta_data: { name: '본인' } });
  expect((await login(email, 'attackerpw1')).statusCode).toBe(401);
  expect((await login(email, 'ownerpw123')).statusCode).toBe(200);
});

test('선점 방지: 60초 제한에 걸린 재가입은 시도도 메일도 만들지 않는다', async () => {
  const email = 'squat3@bara-edu.kr';
  await signup({ email, password: 'firstpw123', name: '첫번째' });
  await signup({ email, password: 'secondpw12', name: '두번째' }); // 제한 안: 시도 추가 + 메일
  expect(mailer.sent).toHaveLength(2);
  const limited = await signup({ email, password: 'thirdpw123', name: '세번째' });
  expect(limited.json()).toEqual({ status: 'pending_confirmation' });
  expect(mailer.sent).toHaveLength(2);
  expect((await attemptsOf(email)).map((a) => a.name)).toEqual(['첫번째', '두번째']);
});

test('선점 방지: 이미 인증된 계정은 덮어쓰지 않고 시도도 만들지 않는다, 응답 형태는 같다', async () => {
  const email = 'squat5@bara-edu.kr';
  await signup({ email, password: 'ownerpw123', name: '주인' });
  await confirm(tokenOf(mailer.sent[0].link), 'ownerpw123');
  const snapshot = await stored(email);
  const r = await signup({ email, password: 'attackerpw1', name: '공격자', phone: '010-6666-6666' });
  expect(r.json()).toEqual({ status: 'pending_confirmation' });
  expect(await stored(email)).toEqual(snapshot);
  expect(await attemptsOf(email)).toHaveLength(0);
  expect((await login(email, 'ownerpw123')).statusCode).toBe(200);
});

test('유효한 시도는 계정당 5개: 6번째가 생기면 가장 오래된 시도와 그 링크가 무효가 된다', async () => {
  const email = 'cap1@bara-edu.kr';
  const links: string[] = [];
  for (let i = 0; i < 6; i++) {
    await resetLimits();
    await signup({ email, password: `password${i}x`, name: `이름${i}번` });
    links.push(tokenOf(mailer.sent.at(-1)!.link));
  }
  expect((await attemptsOf(email)).map((a) => a.name)).toEqual(['이름1번', '이름2번', '이름3번', '이름4번', '이름5번']);
  expect(await checkState(links[0])).toBe('invalid');
  expect(await checkState(links[1])).toBe('ready');
  expect((await confirm(links[0], 'password0x')).statusCode).toBe(400);
});

test('resend: 가장 최근의 잠기지 않은 시도에 새 링크를 붙이고, 모두 잠겼으면 메일을 보내지 않는다 (같은 200)', async () => {
  const email = 'resend-att@bara-edu.kr';
  await signup({ email, password: 'firstpw123' });
  await resetLimits();
  await signup({ email, password: 'secondpw12' });
  const [a1, a2] = await attemptsOf(email);
  mailer.sent.length = 0;
  await resetLimits();
  await post('/v1/auth/resend', { email, origin: ORIGIN });
  const t = tokenOf(mailer.sent[0].link);
  expect((await ctx.adminPool.query('select attempt_id from auth.email_tokens where token_hash = $1', [createHash('sha256').update(t).digest('hex')])).rows[0].attempt_id).toBe(a2.id);
  // 최근 시도가 잠기면 그 전 시도로
  await ctx.adminPool.query('update auth.signup_attempts set locked_at = now() where id = $1', [a2.id]);
  mailer.sent.length = 0;
  await resetLimits();
  await post('/v1/auth/resend', { email, origin: ORIGIN });
  expect((await ctx.adminPool.query('select attempt_id from auth.email_tokens where token_hash = $1', [createHash('sha256').update(tokenOf(mailer.sent[0].link)).digest('hex')])).rows[0].attempt_id).toBe(a1.id);
  // 모두 잠김 -> 메일 없음, 응답은 같다
  await ctx.adminPool.query('update auth.signup_attempts set locked_at = now()');
  mailer.sent.length = 0;
  await resetLimits();
  const r = await post('/v1/auth/resend', { email, origin: ORIGIN });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ status: 'pending_confirmation' });
  expect(mailer.sent).toHaveLength(0);
});

test('login: 미인증 계정은 가입 시도의 비밀번호가 맞으면 email_not_confirmed, 아니면 invalid_credentials (password_reset_required가 아니다)', async () => {
  const email = 'login-unc@bara-edu.kr';
  await signup({ email, password: 'victimpw123' });
  await resetLimits();
  await signup({ email, password: 'attackerpw1' });
  for (const pw of ['victimpw123', 'attackerpw1']) {
    const r = await login(email, pw);
    expect(r.statusCode).toBe(401);
    expect(r.json().error.message).toBe('email_not_confirmed');
  }
  const bad = await login(email, 'nothingpw12');
  expect(bad.statusCode).toBe(401);
  expect(bad.json().error.message).toBe('invalid_credentials');
});

test('셀프 비밀번호 재설정(request-reset, 앱 /forgot-password 화면)으로도 미인증 계정을 확정할 수 있다: 메일함 주인만 링크를 받고, 쓰면 인증 완료 + 모든 가입 시도·링크 무효', async () => {
  const email = 'selfreset1@bara-edu.kr';
  await signup({ email, password: 'attackerpw1', name: '선점자' });
  const signupLink = tokenOf(mailer.sent.at(-1)!.link);
  await resetLimits();
  await signup({ email, password: 'victimpw123', name: '본인' });
  mailer.sent.length = 0;
  const r = await post('/v1/auth/request-reset', { email, origin: ORIGIN });
  expect(r.statusCode).toBe(200);
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0]).toMatchObject({ to: email, template: 'recovery' });
  const resetToken = tokenOf(mailer.sent[0].link);
  expect((await post('/v1/auth/reset-password', { token: resetToken, newPassword: 'ownerchosen1' })).statusCode).toBe(200);
  const u = await stored(email);
  expect(u.email_confirmed_at).not.toBeNull();
  expect(u.encrypted_password).toMatch(/^\$2[aby]\$/);
  expect(await attemptsOf(email)).toHaveLength(0);
  expect(await checkState(signupLink)).toBe('done');
  expect((await confirm(signupLink, 'attackerpw1')).statusCode).toBe(409);
  expect((await login(email, 'attackerpw1')).statusCode).toBe(401);
  expect((await login(email, 'victimpw123')).statusCode).toBe(401); // 시도의 비밀번호는 계정 비밀번호가 되지 않는다
  expect((await login(email, 'ownerchosen1')).statusCode).toBe(200);
});

test('이미 가입된 계정 안내 메일: 60초·1시간 제한이 풀려도 같은 주소에는 24시간에 1통', async () => {
  const email = 'daily1@bara-edu.kr';
  await signup({ email });
  await confirm(tokenOf(mailer.sent[0].link));
  mailer.sent.length = 0;
  const infoMails = () => mailer.sent.filter((m) => m.template === 'already_registered').length;
  const ageLimits = (hours: number) =>
    ctx.adminPool.query("update auth.rate_events set created_at = created_at - make_interval(hours => $1::int) where bucket in ('already-60s','already-1h')", [hours]);

  expect((await signup({ email })).json()).toEqual({ status: 'pending_confirmation' });
  expect(infoMails()).toBe(1);
  await ageLimits(2); // 60초·1시간 창은 지났지만 24시간 안
  const second = await signup({ email });
  expect(second.json()).toEqual({ status: 'pending_confirmation' });
  expect(infoMails()).toBe(1);
  await ctx.adminPool.query("update auth.rate_events set created_at = created_at - interval '25 hours' where bucket = 'already-24h'");
  await signup({ email });
  expect(infoMails()).toBe(2);
});

test('안내 메일 상한은 주소별이다 (다른 주소는 각각 1통)', async () => {
  for (const email of ['daily2@bara-edu.kr', 'daily3@bara-edu.kr']) {
    await signup({ email });
    await confirm(tokenOf(mailer.sent.at(-1)!.link));
  }
  mailer.sent.length = 0;
  await signup({ email: 'daily2@bara-edu.kr' });
  await signup({ email: 'daily3@bara-edu.kr' });
  expect(mailer.sent.filter((m) => m.template === 'already_registered').map((m) => m.to).sort()).toEqual(['daily2@bara-edu.kr', 'daily3@bara-edu.kr']);
});
