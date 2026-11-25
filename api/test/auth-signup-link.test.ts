import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { loadConfig } from '../src/config.js';
import { issueEmailToken } from '../src/auth/tokens.js';
import { setupTestDb } from './helpers/db.js';

// 가입 링크 확인(check)과 확정(complete). 계약: docs/02-design/features/bara-edu-lms.signup-verify-password.api.md
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
beforeEach(async () => {
  mailer.sent.length = 0;
  await ctx.adminPool.query('truncate auth.rate_events');
});

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const q = async (sql: string, p: unknown[] = []) => (await ctx.adminPool.query(sql, p)).rows;
const flush = () => new Promise<void>((r) => setImmediate(r));
const headers = (extra: Record<string, string> = {}) => ({ 'x-bara-service-key': KEY, ...extra });
const post = async (url: string, payload: object, h: Record<string, string> = {}) => {
  const r = await app.inject({ method: 'POST', url, payload, headers: headers(h) });
  await flush();
  return r;
};
const check = (token: string | undefined, h: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: '/v1/auth/signup-link/check', headers: headers({ ...(token === undefined ? {} : { 'x-bara-signup-token': token }), ...h }) });
const complete = (token: string, password: string, h: Record<string, string> = {}) => post('/v1/auth/signup-link/complete', { token, password }, h);

async function newSignup(over: Record<string, unknown> = {}) {
  const email = `link${++n}@bara-edu.kr`;
  await post('/v1/auth/signup', { email, password: 'rightpass1', name: '홍길동', phone: '010-1234-5678', origin: ORIGIN, ...over });
  const token = new URL(mailer.sent.at(-1)!.link).searchParams.get('token')!;
  const [u] = await q('select id from auth.users where email = $1', [email]);
  const [a] = await q('select id from auth.signup_attempts where user_id = $1 order by created_at desc limit 1', [u.id]);
  return { email, token, userId: u.id as string, attemptId: a.id as string };
}
const failCount = async (attemptId: string) => (await q('select fail_count from auth.signup_attempts where id = $1', [attemptId]))[0]?.fail_count;

// ---- check

test('check: ready — 이메일·요청 시각·만료·남은 횟수만 준다 (이름·연락처는 주지 않는다)', async () => {
  const s = await newSignup();
  const r = await check(s.token);
  expect(r.statusCode).toBe(200);
  const b = r.json();
  expect(Object.keys(b).sort()).toEqual(['attemptsLeft', 'email', 'expiresAt', 'requestedAt', 'state']);
  expect(b).toMatchObject({ state: 'ready', email: s.email, attemptsLeft: 5 });
  const ttl = (new Date(b.expiresAt).getTime() - Date.now()) / 3_600_000;
  expect(ttl).toBeGreaterThan(23.9);
  expect(ttl).toBeLessThanOrEqual(24);
  expect(Math.abs(new Date(b.requestedAt).getTime() - Date.now())).toBeLessThan(60_000);
});

test('check는 읽기 전용이다: 여러 번 불러도 토큰·실패 횟수·세션·메일이 그대로고, 그 뒤에도 complete가 성공한다 (메일 스캐너)', async () => {
  const s = await newSignup();
  const snap = async () =>
    JSON.stringify([
      await q('select * from auth.email_tokens order by token_hash'),
      await q('select * from auth.signup_attempts order by id'),
      await q('select * from auth.sessions'),
      await q('select email_confirmed_at, updated_at from auth.users order by id'),
    ]);
  mailer.sent.length = 0;
  const before = await snap();
  for (let i = 0; i < 5; i++) expect((await check(s.token)).json().state).toBe('ready');
  expect(await snap()).toBe(before);
  expect(mailer.sent).toHaveLength(0);
  expect((await complete(s.token, 'rightpass1')).statusCode).toBe(200);
});

test('check: 헤더 없음·빈 값·너무 긴 값·모르는 토큰·recovery 토큰 → invalid', async () => {
  const s = await newSignup();
  const recovery = await issueEmailToken(ctx.pool, s.userId, 'recovery');
  for (const t of [undefined, '', 'x'.repeat(201), 'nope', recovery]) {
    const r = await check(t);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ state: 'invalid' });
  }
});

test('check: 확정 후 done, 만료 expired, 잠김 locked, 시도 정리·옛 방식 토큰 invalid, 탈퇴 계정 invalid — ready 외에는 개인정보가 없다', async () => {
  const done = await newSignup();
  await complete(done.token, 'rightpass1');
  expect((await check(done.token)).json()).toEqual({ state: 'done' });

  const exp = await newSignup();
  await q("update auth.email_tokens set expires_at = now() - interval '1 second' where token_hash = $1", [sha(exp.token)]);
  expect((await check(exp.token)).json()).toEqual({ state: 'expired' });

  const att = await newSignup();
  await q("update auth.signup_attempts set expires_at = now() - interval '1 second' where id = $1", [att.attemptId]);
  expect((await check(att.token)).json()).toEqual({ state: 'expired' });

  const lock = await newSignup();
  await q('update auth.signup_attempts set locked_at = now() where id = $1', [lock.attemptId]);
  expect((await check(lock.token)).json()).toEqual({ state: 'locked' });

  const purged = await newSignup();
  await q('delete from auth.signup_attempts where id = $1', [purged.attemptId]); // 정리 작업과 같은 결과: 토큰만 남고 attempt_id는 비워진다
  expect((await check(purged.token)).json()).toEqual({ state: 'invalid' });

  const legacy = await newSignup();
  await q('update auth.email_tokens set attempt_id = null where token_hash = $1', [sha(legacy.token)]);
  expect((await check(legacy.token)).json()).toEqual({ state: 'invalid' });

  const gone = await newSignup();
  await q("update auth.users set email = 'withdrawn+x@deleted.invalid', email_confirmed_at = now() where id = $1", [gone.userId]);
  expect((await check(gone.token)).json()).toEqual({ state: 'invalid' }); // done으로 보이면 사실과 다르다
});

test('check·complete: 이미 인증된 계정(관리자 재설정 등)의 미사용 링크는 done, 비밀번호가 맞아도 로그인시키지 않는다', async () => {
  const s = await newSignup();
  await q('update auth.users set email_confirmed_at = now() where id = $1', [s.userId]);
  expect((await check(s.token)).json()).toEqual({ state: 'done' });
  const r = await complete(s.token, 'rightpass1');
  expect(r.statusCode).toBe(409);
  expect(r.json().error.message).toBe('link_done');
  expect(await q('select 1 from auth.sessions where user_id = $1', [s.userId])).toHaveLength(0);
  expect(await failCount(s.attemptId)).toBe(0); // 비밀번호는 비교하지 않았다
});

test('check: IP당 15분 60회, 61번째는 429', async () => {
  const h = { 'x-bara-client-ip': '203.0.113.50' };
  for (let i = 0; i < 60; i++) expect((await check('nope', h)).statusCode).toBe(200);
  const r = await check('nope', h);
  expect(r.statusCode).toBe(429);
  expect(r.json().error.code).toBe('rate_limited');
  expect((await check('nope', { 'x-bara-client-ip': '203.0.113.51' })).statusCode).toBe(200);
});

// ---- complete

test('complete 성공: 그 시도의 비밀번호·이름·연락처로 확정, 세션 발급(자동 로그인), 같은 비밀번호로 로그인 가능', async () => {
  const s = await newSignup({ password: 'my-secret 1 ', name: '김바라', phone: '010-5555-6666' });
  const r = await complete(s.token, 'my-secret 1 ');
  expect(r.statusCode).toBe(200);
  const { sessionToken, expiresAt } = r.json();
  expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  const me = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: headers({ 'x-bara-session': sessionToken }) });
  expect(me.json().user).toMatchObject({ email: s.email });
  expect(me.json().user.emailConfirmedAt).not.toBeNull();
  const [u] = await q('select u.raw_user_meta_data, p.name, p.phone from auth.users u join profiles p on p.id = u.id where u.id = $1', [s.userId]);
  expect(u).toMatchObject({ name: '김바라', phone: '010-5555-6666', raw_user_meta_data: { name: '김바라', phone: '010-5555-6666' } });
  // 앞뒤 공백이 비밀번호의 일부다(자르지 않는다)
  expect((await post('/v1/auth/login', { email: s.email, password: 'my-secret 1 ' })).statusCode).toBe(200);
  expect((await post('/v1/auth/login', { email: s.email, password: 'my-secret 1' })).statusCode).toBe(401);
});

test('complete 불일치: 403 wrong_password + attemptsLeft 4,3,2,1, 5번째 불일치는 409 link_locked (영구 잠금)', async () => {
  const s = await newSignup();
  for (const left of [4, 3, 2, 1]) {
    const r = await complete(s.token, 'wrongpass1');
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ error: { code: 'forbidden', message: 'wrong_password', attemptsLeft: left } });
    expect((await check(s.token)).json()).toMatchObject({ state: 'ready', attemptsLeft: left });
  }
  const fifth = await complete(s.token, 'wrongpass1');
  expect(fifth.statusCode).toBe(409);
  expect(fifth.json()).toEqual({ error: { code: 'conflict', message: 'link_locked' } });
  expect((await check(s.token)).json()).toEqual({ state: 'locked' });
  expect((await q('select locked_at from auth.signup_attempts where id = $1', [s.attemptId]))[0].locked_at).not.toBeNull();
  // 잠긴 뒤에는 맞는 비밀번호도 받지 않는다. 비교하지 않으므로 횟수도 늘지 않는다
  const after = await complete(s.token, 'rightpass1');
  expect(after.statusCode).toBe(409);
  expect(after.json().error.message).toBe('link_locked');
  expect(await failCount(s.attemptId)).toBe(5);
  expect((await q('select email_confirmed_at from auth.users where id = $1', [s.userId]))[0].email_confirmed_at).toBeNull();
});

test('잠금은 재전송(resend)으로 풀리지 않는다 — 잠긴 시도에는 새 링크도 붙지 않는다', async () => {
  const s = await newSignup();
  for (let i = 0; i < 5; i++) await complete(s.token, 'wrongpass1');
  mailer.sent.length = 0;
  await ctx.adminPool.query('truncate auth.rate_events');
  await post('/v1/auth/resend', { email: s.email, origin: ORIGIN });
  expect(mailer.sent).toHaveLength(0);
  expect((await q('select count(*)::int c from auth.email_tokens where user_id = $1', [s.userId]))[0].c).toBe(1);
});

test('재전송으로 받은 새 링크도 같은 시도라 실패 횟수가 이어진다', async () => {
  const s = await newSignup();
  await complete(s.token, 'wrongpass1');
  await complete(s.token, 'wrongpass1');
  mailer.sent.length = 0;
  await ctx.adminPool.query('truncate auth.rate_events');
  await post('/v1/auth/resend', { email: s.email, origin: ORIGIN });
  const t2 = new URL(mailer.sent[0].link).searchParams.get('token')!;
  expect((await check(t2)).json()).toMatchObject({ state: 'ready', attemptsLeft: 3 });
});

test('5번째 시도에 맞는 비밀번호를 넣으면 성공한다 (잠금은 5회째 "불일치"에서 걸린다)', async () => {
  const s = await newSignup();
  for (let i = 0; i < 4; i++) await complete(s.token, 'wrongpass1');
  expect((await complete(s.token, 'rightpass1')).statusCode).toBe(200);
});

test('동시에 틀린 비밀번호를 10번 보내도 비교는 5번을 넘지 않고 잠긴다', async () => {
  const s = await newSignup();
  const rs = await Promise.all(Array.from({ length: 10 }, () => complete(s.token, 'wrongpass1')));
  expect(rs.every((r) => r.statusCode === 403 || r.statusCode === 409)).toBe(true);
  expect(rs.filter((r) => r.statusCode === 403).length).toBeLessThanOrEqual(4);
  expect(await failCount(s.attemptId)).toBe(5);
  expect((await check(s.token)).json()).toEqual({ state: 'locked' });
});

test('같은 링크를 동시에 두 번 확정(더블 탭): 하나는 200, 다른 하나는 409 link_done, 세션은 하나', async () => {
  const s = await newSignup();
  const rs = await Promise.all([complete(s.token, 'rightpass1'), complete(s.token, 'rightpass1')]);
  expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(rs.find((r) => r.statusCode === 409)!.json().error.message).toBe('link_done');
  expect(await q('select 1 from auth.sessions where user_id = $1', [s.userId])).toHaveLength(1);
});

test('같은 계정의 서로 다른 두 시도를 동시에 확정: 먼저 끝난 쪽만 이기고 나머지는 409, 비밀번호는 이긴 쪽 것 하나', async () => {
  const a = await newSignup({ password: 'victimpass1', name: '본인' });
  await ctx.adminPool.query('truncate auth.rate_events');
  await post('/v1/auth/signup', { email: a.email, password: 'attackpass1', name: '공격자', origin: ORIGIN });
  const linkB = new URL(mailer.sent.at(-1)!.link).searchParams.get('token')!;
  const rs = await Promise.all([complete(a.token, 'victimpass1'), complete(linkB, 'attackpass1')]);
  expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const winner = rs[0].statusCode === 200 ? 'victimpass1' : 'attackpass1';
  expect((await post('/v1/auth/login', { email: a.email, password: winner })).statusCode).toBe(200);
  expect((await post('/v1/auth/login', { email: a.email, password: winner === 'victimpass1' ? 'attackpass1' : 'victimpass1' })).statusCode).toBe(401);
  expect(await q('select 1 from auth.signup_attempts where user_id = $1', [a.userId])).toHaveLength(0);
});

test('complete: 429(IP 한도)에서는 실패 횟수를 올리지 않는다', async () => {
  const s = await newSignup();
  const h = { 'x-bara-client-ip': '203.0.113.60' };
  for (let i = 0; i < 30; i++) await post('/v1/auth/signup-link/complete', { token: 'nope', password: 'x' }, h);
  const r = await complete(s.token, 'wrongpass1', h);
  expect(r.statusCode).toBe(429);
  expect(r.json().error.code).toBe('rate_limited');
  expect(await failCount(s.attemptId)).toBe(0);
});

test('모르는 토큰과 만료된 링크는 비밀번호를 비교하지 않고 회원 정보를 응답에 싣지 않는다', async () => {
  const s = await newSignup();
  const unknown = await complete('definitely-unknown', 'rightpass1');
  expect(unknown.statusCode).toBe(400);
  expect(JSON.stringify(unknown.json())).not.toContain(s.email);
  await q("update auth.email_tokens set expires_at = now() - interval '1 second' where token_hash = $1", [sha(s.token)]);
  const exp = await complete(s.token, 'wrongpass1');
  expect(exp.json()).toEqual({ error: { code: 'conflict', message: 'link_expired' } });
  expect(await failCount(s.attemptId)).toBe(0);
});

test('가입 시도를 정리하면(7일 경과) 그 링크는 invalid이고 확정되지 않는다', async () => {
  const s = await newSignup();
  await q("update auth.signup_attempts set expires_at = now() - interval '1 second' where id = $1", [s.attemptId]);
  await q('select public.purge_unverified_signups()');
  expect((await complete(s.token, 'rightpass1')).statusCode).toBe(400);
  expect((await check(s.token)).json()).toEqual({ state: 'invalid' });
});
