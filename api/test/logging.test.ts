import { afterAll, beforeAll, expect, test } from 'vitest';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { defineOp } from '../src/ops/registry.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'logging-test-service-key-0123456789abcdef';
const SECRET_EMAIL = 'leak-me@bara-edu.kr';
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
const lines: string[] = [];

const dup = defineOp({
  name: 'test.dup',
  access: 'service',
  params: z.object({}),
  run: async ({ tx }) => tx.query('insert into auth.users (email) values ($1), ($1)', [SECRET_EMAIL]),
});

beforeAll(async () => {
  ctx = await setupTestDb();
  const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });
  app = buildApp({ config, pool: ctx.pool, mailer: new MemoryMailer(), storage: new MemoryStorage(), logger: { level: 'info', stream: { write: (l: string) => void lines.push(l) } } }, [dup]);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

test('500 로그의 err에는 pg detail·파라미터가 없고, 서비스 키·세션 토큰도 남지 않는다', async () => {
  const u = await ctx.adminPool.query<{ id: string }>("insert into auth.users (email) values ('log-user@bara-edu.kr') returning id");
  const s = await createSession(ctx.pool, u.rows[0].id, 30);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/op/test.dup',
    payload: { params: {} },
    headers: { 'x-bara-service-key': KEY, 'x-bara-session': s.token },
  });
  expect(res.statusCode).toBe(500);

  const entries = lines.map((l) => JSON.parse(l));
  const errEntry = entries.find((e) => e.err);
  expect(errEntry).toBeDefined();
  expect(errEntry.level).toBe(50);
  expect(errEntry.err.code).toBe('23505');
  expect(errEntry.err).not.toHaveProperty('detail');
  expect(errEntry.err).not.toHaveProperty('parameters');
  const all = lines.join('\n');
  expect(all).not.toContain(SECRET_EMAIL);
  expect(all).not.toContain(KEY);
  expect(all).not.toContain(s.token);
});

test('pg 오류 로그에는 message·stack이 없고 code·constraint·table만 남는다', () => {
  const errEntry = lines.map((l) => JSON.parse(l)).find((e) => e.err);
  expect(errEntry.err).not.toHaveProperty('message');
  expect(errEntry.err).not.toHaveProperty('stack');
  expect(errEntry.err.code).toBe('23505');
  expect(errEntry.err.constraint).toEqual(expect.any(String));
  expect(errEntry.err.table).toBe('users');
});

test('탈퇴 후 사진 삭제가 실패하면 로그에 userId와 오류 이름만 남는다 (이메일 없음)', async () => {
  const email = 'photo-fail@bara-edu.kr';
  const id = (await ctx.adminPool.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email])).rows[0].id as string;
  const token = (await createSession(ctx.pool, id, 30)).token;
  const failing = { put: async () => {}, signedUrl: async () => '', remove: async () => { throw Object.assign(new Error(`s3 said ${email}`), { name: 'S3Down' }); } };
  const out: string[] = [];
  const failApp = buildApp({ config: loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY }), pool: ctx.pool, mailer: new MemoryMailer(), storage: failing as never, logger: { level: 'info', stream: { write: (l: string) => void out.push(l) } } });
  const r = await failApp.inject({ method: 'POST', url: '/v1/account/withdraw', headers: { 'x-bara-service-key': KEY, 'x-bara-session': token }, payload: { reason: 'other' } });
  await failApp.close();
  expect(r.statusCode).toBe(200);
  const line = out.find((l) => l.includes('withdraw photo removal failed'));
  expect(line).toBeTruthy();
  expect(JSON.parse(line!)).toMatchObject({ userId: id, errorName: 'S3Down' });
  expect(out.join('')).not.toContain(email);
});

test('가입 링크 확인 요청의 토큰 헤더(x-bara-signup-token)는 로그에 남지 않는다', async () => {
  const token = 'signup-link-secret-token-0123456789';
  const res = await app.inject({ method: 'GET', url: '/v1/auth/signup-link/check', headers: { 'x-bara-service-key': KEY, 'x-bara-signup-token': token } });
  expect(res.json()).toEqual({ state: 'invalid' });
  expect(lines.join('\n')).not.toContain(token);
  expect(lines.some((l) => l.includes('/v1/auth/signup-link/check'))).toBe(true); // 요청 로그는 남되 토큰만 없다
});
