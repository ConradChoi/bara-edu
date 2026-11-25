import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { loadConfig } from '../src/config.js';
import { MemoryMailer, type Mailer } from '../src/mail/mailer.js';
import { issueEmailToken } from '../src/auth/tokens.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
const ORIGIN = 'https://bara-edu.kr';
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
let mailer: MemoryMailer;
let failing = false;
let n = 0;

beforeAll(async () => {
  ctx = await setupTestDb();
  mailer = new MemoryMailer();
  const flaky: Mailer = {
    async send(m) {
      if (failing) throw new Error('smtp down');
      return mailer.send(m);
    },
  };
  const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });
  app = buildApp({ config, pool: ctx.pool, mailer: flaky, storage: new MemoryStorage() });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});
beforeEach(async () => {
  failing = false;
  mailer.sent.length = 0;
  await ctx.adminPool.query('truncate auth.rate_events');
});

const flushMail = () => new Promise<void>((r) => setImmediate(r));

const call = async (method: 'GET' | 'POST', url: string, payload?: unknown, session?: string) => {
  const res = await app.inject({
    method,
    url,
    payload: payload as object | undefined,
    headers: { 'x-bara-service-key': KEY, ...(session ? { 'x-bara-session': session } : {}) },
  });
  await flushMail();
  return res;
};
const login = (email: string, password = 'password1') => call('POST', '/v1/auth/login', { email, password });

async function addUser(opts: { confirmed?: boolean; admin?: boolean } = {}) {
  const email = `adm${++n}@bara-edu.kr`;
  const r = await ctx.adminPool.query<{ id: string }>(
    'insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ($1, $2, $3, $4) returning id',
    [email, await bcrypt.hash('password1', 10), opts.confirmed === false ? null : new Date(), JSON.stringify({ name: '회원' })],
  );
  const id = r.rows[0].id;
  if (opts.admin) {
    await ctx.adminPool.query(`begin; set local session_replication_role = replica; update profiles set role='admin' where id='${id}'; commit`);
  }
  return { email, id };
}
const sessionOf = async (email: string) => (await login(email)).json().sessionToken as string;
const adminSession = async () => sessionOf((await addUser({ admin: true })).email);
const sessionStatus = async (t: string) => (await call('GET', '/v1/auth/session', undefined, t)).statusCode;

test('학습자가 confirm-email 호출 → 403, email_confirmed_at 그대로', async () => {
  const learner = await addUser();
  const target = await addUser({ confirmed: false });
  const r = await call('POST', `/v1/admin/users/${target.id}/confirm-email`, undefined, await sessionOf(learner.email));
  expect(r.statusCode).toBe(403);
  expect(r.json().error.code).toBe('forbidden');
  const row = await ctx.adminPool.query('select email_confirmed_at from auth.users where id=$1', [target.id]);
  expect(row.rows[0].email_confirmed_at).toBeNull();
});

test('세션 없이 관리자 경로 → 401', async () => {
  const target = await addUser({ confirmed: false });
  expect((await call('POST', `/v1/admin/users/${target.id}/confirm-email`)).statusCode).toBe(401);
  expect((await call('POST', `/v1/admin/users/${target.id}/send-reset`, { origin: ORIGIN })).statusCode).toBe(401);
  expect((await call('GET', '/v1/admin/users/confirmations')).statusCode).toBe(401);
});

test('관리자가 confirm-email → 대상 회원 로그인 가능해짐', async () => {
  const target = await addUser({ confirmed: false });
  expect((await login(target.email)).json().error.message).toBe('email_not_confirmed');
  const r = await call('POST', `/v1/admin/users/${target.id}/confirm-email`, undefined, await adminSession());
  expect(r.statusCode).toBe(200);
  expect((await login(target.email)).statusCode).toBe(200);
});

test('confirmations: 회원 3명의 id와 인증 시각', async () => {
  const admin = await adminSession();
  const a = await addUser();
  const b = await addUser({ confirmed: false });
  const c = await addUser();
  const r = await call('GET', '/v1/admin/users/confirmations', undefined, admin);
  expect(r.statusCode).toBe(200);
  const items = r.json().items as Array<{ id: string; emailConfirmedAt: string | null }>;
  const by = new Map(items.map((i) => [i.id, i.emailConfirmedAt]));
  expect(by.get(b.id)).toBeNull();
  for (const u of [a, c]) expect(Date.parse(by.get(u.id)!)).not.toBeNaN();
  const ids = items.map((i) => i.id);
  expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
  expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(c.id));
});

test('learner confirmations → 403', async () => {
  const learner = await addUser();
  expect((await call('GET', '/v1/admin/users/confirmations', undefined, await sessionOf(learner.email))).statusCode).toBe(403);
});

test('send-reset: 메일 발송, 링크로 비밀번호 재설정 가능', async () => {
  const target = await addUser();
  const r = await call('POST', `/v1/admin/users/${target.id}/send-reset`, { origin: ORIGIN }, await adminSession());
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ ok: true, mailSent: true });
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0].to).toBe(target.email);
  const token = new URL(mailer.sent[0].link).searchParams.get('token')!;
  expect(mailer.sent[0].link.startsWith(`${ORIGIN}/reset-password?token=`)).toBe(true);
  expect((await call('POST', '/v1/auth/reset-password', { token, newPassword: 'newpassword1' })).statusCode).toBe(200);
  expect((await login(target.email, 'newpassword1')).statusCode).toBe(200);
});

test('send-reset: 메일은 응답 뒤 발송되므로 발송 실패여도 200 + mailSent:true', async () => {
  const target = await addUser();
  const admin = await adminSession();
  failing = true;
  const r = await call('POST', `/v1/admin/users/${target.id}/send-reset`, { origin: ORIGIN }, admin);
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ ok: true, mailSent: true });
});

test('send-reset: 허용되지 않은 origin → 400, 없는 회원 → 404', async () => {
  const target = await addUser();
  const admin = await adminSession();
  expect((await call('POST', `/v1/admin/users/${target.id}/send-reset`, { origin: 'https://evil.example' }, admin)).statusCode).toBe(400);
  const nf = await call('POST', '/v1/admin/users/00000000-0000-4000-8000-000000000000/send-reset', { origin: ORIGIN }, admin);
  expect(nf.statusCode).toBe(404);
  expect(mailer.sent).toHaveLength(0);
});

test('logout-all: 세션 없으면 401, 다른 회원 세션은 그대로', async () => {
  const a = await addUser();
  const b = await addUser();
  const sa = await sessionOf(a.email);
  const sb = await sessionOf(b.email);
  const r = await call('POST', '/v1/auth/logout-all');
  expect(r.statusCode).toBe(401);
  expect(r.json().error.code).toBe('unauthenticated');
  expect((await call('POST', '/v1/auth/logout-all', undefined, sa)).statusCode).toBe(200);
  expect(await sessionStatus(sa)).toBe(401);
  expect(await sessionStatus(sb)).toBe(200);
});

test('없는 회원 id → 404, UUID가 아닌 id → 400', async () => {
  const admin = await adminSession();
  const nf = await call('POST', '/v1/admin/users/00000000-0000-4000-8000-000000000000/confirm-email', undefined, admin);
  expect(nf.statusCode).toBe(404);
  expect(nf.json().error.code).toBe('not_found');
  const bad = await call('POST', '/v1/admin/users/not-a-uuid/confirm-email', undefined, admin);
  expect(bad.statusCode).toBe(400);
  expect(bad.json().error.code).toBe('validation');
});

