import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { loadConfig } from '../src/config.js';
import type { Mailer, MailMessage } from '../src/mail/mailer.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
const ORIGIN = 'https://bara-edu.kr';
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
let n = 0;
const called: MailMessage[] = [];
let gate: Promise<void> = Promise.resolve();

const mailer: Mailer = {
  async send(msg) {
    called.push(msg);
    await gate;
  },
};
const flush = () => new Promise<void>((r) => setImmediate(r));

beforeAll(async () => {
  ctx = await setupTestDb();
  const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });
  app = buildApp({ config, pool: ctx.pool, mailer, storage: new MemoryStorage() });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});
beforeEach(async () => {
  called.length = 0;
  gate = Promise.resolve();
  await ctx.adminPool.query('truncate auth.rate_events');
});

const post = (url: string, payload: unknown, ip?: string) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: { 'x-bara-service-key': KEY, ...(ip !== undefined ? { 'x-bara-client-ip': ip } : {}) } });
const reset = (email: string, ip?: string) => post('/v1/auth/request-reset', { email, origin: ORIGIN }, ip);

async function addUser(): Promise<string> {
  const email = `lim${++n}@bara-edu.kr`;
  await ctx.adminPool.query('insert into auth.users (email, encrypted_password, email_confirmed_at) values ($1, $2, now())', [email, await bcrypt.hash('password1', 10)]);
  return email;
}

test('request-reset: 있는 계정과 없는 계정의 상태·본문이 같고, 메일 발송은 응답을 기다리지 않는다', async () => {
  const email = await addUser();
  let release!: () => void;
  gate = new Promise<void>((r) => (release = r));
  // the response must resolve while the mailer is still blocked, otherwise it would hang here
  const existing = await reset(email);
  const ghost = await reset('nobody-here@bara-edu.kr');
  expect(existing.statusCode).toBe(ghost.statusCode);
  expect(existing.json()).toEqual(ghost.json());
  await flush();
  expect(called).toHaveLength(1);
  expect(called[0]).toMatchObject({ to: email, template: 'recovery' });
  release();
});

test('request-reset: 없는 계정도 같은 DB 작업량(조회 1회 + 제한 기록)을 남긴다', async () => {
  const email = await addUser();
  await reset(email, '198.51.100.1');
  const count = async (bucket: string) => Number((await ctx.adminPool.query('select count(*) from auth.rate_events where bucket = $1', [bucket])).rows[0].count);
  await reset('nobody-here2@bara-edu.kr', '198.51.100.2');
  expect(await count('reset-miss')).toBe(1);
  expect(await count('reset-60s')).toBe(2);
});

test('발송 실패는 응답에 영향이 없다', async () => {
  const email = await addUser();
  const failApp = buildApp({ config: app.deps.config, pool: ctx.pool, mailer: { async send() { throw new Error('ses down'); } }, storage: new MemoryStorage() });
  const r = await failApp.inject({ method: 'POST', url: '/v1/auth/request-reset', headers: { 'x-bara-service-key': KEY }, payload: { email, origin: ORIGIN } });
  await flush();
  await failApp.close();
  expect(r.statusCode).toBe(200);
});

test('같은 IP에서 request-reset 21번째 → 429', async () => {
  for (let i = 0; i < 20; i++) expect((await reset(`rr${i}@bara-edu.kr`, '203.0.113.50')).statusCode).toBe(200);
  const r = await reset('rr-last@bara-edu.kr', '203.0.113.50');
  expect(r.statusCode).toBe(429);
  expect(r.json().error.code).toBe('rate_limited');
  expect((await reset('rr-other@bara-edu.kr', '203.0.113.51')).statusCode).toBe(200);
});

test('같은 IP에서 resend 21번째 → 429, request-reset 카운터와 섞이지 않는다', async () => {
  const resend = (email: string, ip: string) => post('/v1/auth/resend', { email, origin: ORIGIN }, ip);
  for (let i = 0; i < 20; i++) expect((await resend(`rs${i}@bara-edu.kr`, '203.0.113.60')).statusCode).toBe(200);
  expect((await resend('rs-last@bara-edu.kr', '203.0.113.60')).statusCode).toBe(429);
  expect((await reset('rs-reset@bara-edu.kr', '203.0.113.60')).statusCode).toBe(200);
});

test('같은 IP에서 서로 다른 이메일로 login 51번째 → 429', async () => {
  const login = (i: number) => post('/v1/auth/login', { email: `lg${i}@bara-edu.kr`, password: 'password1' }, '203.0.113.70');
  for (let i = 0; i < 50; i++) expect((await login(i)).statusCode).toBe(401);
  const r = await login(50);
  expect(r.statusCode).toBe(429);
  expect(r.json().error.code).toBe('rate_limited');
});

test('x-bara-client-ip가 없거나 비어 있으면 IP 제한을 걸지 않는다', async () => {
  for (let i = 0; i < 22; i++) expect((await reset(`np${i}@bara-edu.kr`)).statusCode).toBe(200);
  for (let i = 0; i < 22; i++) expect((await reset(`ne${i}@bara-edu.kr`, '  ')).statusCode).toBe(200);
  const rows = await ctx.adminPool.query("select 1 from auth.rate_events where bucket like '%-ip'");
  expect(rows.rowCount).toBe(0);
});

test('IP 키는 64자로 잘린다', async () => {
  await reset('long-ip@bara-edu.kr', 'x'.repeat(200));
  const r = await ctx.adminPool.query("select key from auth.rate_events where bucket = 'reset-ip'");
  expect(r.rows[0].key).toHaveLength(64);
});

test('같은 /64의 다른 IPv6 주소로 계속 요청해도 한도(login 50회/15분)에서 막히고, 다른 /64는 영향 없다', async () => {
  const login = (i: number, ip: string) => post('/v1/auth/login', { email: `v6${i}@bara-edu.kr`, password: 'password1' }, ip);
  for (let i = 0; i < 50; i++) expect((await login(i, `2001:db8:aa:bb:${i + 1}::${i + 1}`)).statusCode).toBe(401);
  const blocked = await login(50, '2001:DB8:AA:BB:ffff:ffff:ffff:ffff');
  expect(blocked.statusCode).toBe(429);
  expect(blocked.json().error.code).toBe('rate_limited');
  expect((await login(51, '2001:db8:aa:bc::1')).statusCode).toBe(401);
  const keys = await ctx.adminPool.query("select distinct key from auth.rate_events where bucket = 'login-ip' order by key");
  expect(keys.rows.map((r) => r.key)).toEqual(['2001:db8:aa:bb::/64', '2001:db8:aa:bc::/64']);
});

test('IPv4-mapped IPv6와 IPv4는 같은 키를 쓴다', async () => {
  await reset('m1@bara-edu.kr', '::ffff:198.51.100.9');
  await reset('m2@bara-edu.kr', '198.51.100.9');
  const r = await ctx.adminPool.query("select key, count(*)::int n from auth.rate_events where bucket = 'reset-ip' group by key");
  expect(r.rows).toEqual([{ key: '198.51.100.9', n: 2 }]);
});
