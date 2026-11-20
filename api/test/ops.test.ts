import { afterAll, beforeAll, expect, test } from 'vitest';
import pg from 'pg';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { defineOp, registerOps } from '../src/ops/registry.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
let one: pg.Pool;
let oneApp: FastifyInstance;

const whoami = defineOp({
  name: 'test.whoami',
  access: 'anon',
  params: z.object({}),
  run: async ({ tx, userId }) => ({ userId, ...(await tx.query('select auth.uid() u, current_user cu')).rows[0] }),
});
const boom = defineOp({
  name: 'test.boom',
  access: 'user',
  params: z.object({}),
  run: async () => {
    throw new Error('pg: secret detail');
  },
});
const svc = defineOp({
  name: 'test.svc',
  access: 'service',
  params: z.object({}),
  run: async ({ tx, userId }) => ({ userId, cu: (await tx.query('select current_user cu')).rows[0].cu }),
});

beforeAll(async () => {
  ctx = await setupTestDb();
  const extra = [whoami, boom, svc];
  app = buildApp({ config, pool: ctx.pool, mailer: new MemoryMailer() }, extra);
  await app.ready();
  one = new pg.Pool({ connectionString: ctx.pool.options.connectionString, max: 1 });
  oneApp = buildApp({ config, pool: one, mailer: new MemoryMailer() }, extra);
  await oneApp.ready();
});
afterAll(async () => {
  await oneApp.close();
  await one.end();
  await app.close();
  await ctx.close();
});

async function newUser(name: string): Promise<{ id: string; email: string; token: string }> {
  const email = `${name}@example.com`;
  const u = await ctx.adminPool.query('insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, now(), $2) returning id', [
    email,
    { name },
  ]);
  const id = u.rows[0].id;
  const { token } = await createSession(ctx.pool, id, 30);
  return { id, email, token };
}

function op(a: FastifyInstance, name: string, token?: string, payload: unknown = { params: {} }) {
  const headers: Record<string, string> = { 'x-bara-service-key': KEY };
  if (token) headers['x-bara-session'] = token;
  return a.inject({ method: 'POST', url: `/v1/op/${name}`, headers, payload: payload as any });
}

test('profiles.getMine: 본인 행만', async () => {
  const a = await newUser('alice');
  const b = await newUser('bobby');
  const ra = await op(app, 'profiles.getMine', a.token);
  expect(ra.statusCode).toBe(200);
  expect(ra.json().data).toEqual({ id: a.id, name: 'alice', phone: null, role: 'learner', status: 'active', email: a.email });
  const rb = await op(app, 'profiles.getMine', b.token);
  expect(rb.json().data.id).toBe(b.id);
});

test('bank_accounts.list: 로그인 회원에게 명시된 컬럼만, 순서대로', async () => {
  await ctx.adminPool.query(
    `insert into bank_accounts (bank_name, account_number, account_holder, "order") values ('B은행','222','홍길동',2), ('A은행','111','홍길동',1)`,
  );
  const u = await newUser('carol');
  const r = await op(app, 'bank_accounts.list', u.token);
  expect(r.statusCode).toBe(200);
  const rows = r.json().data;
  expect(rows.map((x: any) => x.bank_name)).toEqual(['A은행', 'B은행']);
  expect(Object.keys(rows[0]).sort()).toEqual(['account_holder', 'account_number', 'bank_name', 'id', 'order']);
});

test('세션 없이 user 오퍼레이션 → 401', async () => {
  const r = await op(app, 'profiles.getMine');
  expect(r.statusCode).toBe(401);
  expect(r.json().error.code).toBe('unauthenticated');
  expect((await op(app, 'test.svc')).statusCode).toBe(401);
});

test('anon 오퍼레이션: 세션이 있으면 withUser, 없으면 withAnon', async () => {
  const u = await newUser('dave');
  expect((await op(app, 'test.whoami', u.token)).json().data).toEqual({ userId: u.id, u: u.id, cu: 'bara_edu_authenticated' });
  expect((await op(app, 'test.whoami')).json().data).toEqual({ userId: null, u: null, cu: 'bara_edu_anon' });
});

test('service 오퍼레이션: withService, userId는 ctx로 전달', async () => {
  const u = await newUser('erin');
  expect((await op(app, 'test.svc', u.token)).json().data).toEqual({ userId: u.id, cu: 'bara_edu_service' });
});

test('없는 오퍼레이션 → 404, params 형식 오류 → 400', async () => {
  const u = await newUser('frank');
  const nf = await op(app, 'nope.missing', u.token);
  expect(nf.statusCode).toBe(404);
  expect(nf.json().error.code).toBe('not_found');
  const bad = await op(app, 'profiles.getMine', u.token, { params: { x: 1 } });
  expect(bad.statusCode).toBe(400);
  expect(bad.json().error.code).toBe('validation');
  expect((await op(app, 'profiles.getMine', u.token, '[]')).statusCode).toBe(400);
  expect((await op(app, 'profiles.getMine', u.token, { params: 'str' })).statusCode).toBe(400);
});

test('서비스 키 없으면 401', async () => {
  const r = await app.inject({ method: 'POST', url: '/v1/op/profiles.getMine', payload: { params: {} } });
  expect(r.statusCode).toBe(401);
});

test('오퍼레이션 안에서 예외 → 500 internal, 다음 요청에 권한 누수 없음', async () => {
  const u = await newUser('gina');
  const pid = async () => (await one.query('select pg_backend_pid() p')).rows[0].p;
  const before = await pid();
  const r = await op(oneApp, 'test.boom', u.token);
  expect(r.statusCode).toBe(500);
  expect(r.json()).toEqual({ error: { code: 'internal', message: '서버 오류가 발생했습니다.' } });
  expect(r.body).not.toContain('secret');
  const next = await op(oneApp, 'test.whoami');
  expect(next.json().data).toEqual({ userId: null, u: null, cu: 'bara_edu_anon' });
  expect(await pid()).toBe(before);
});

test('이름이 중복이면 registerOps가 throw', () => {
  const mk = () => defineOp({ name: 'a.b', access: 'anon', params: z.object({}), run: async () => 1 });
  expect(() => registerOps([mk(), mk()])).toThrow(/duplicate/);
  expect(registerOps([mk()]).size).toBe(1);
});

test.each(['profiles', 'Profiles.get', 'a.b.c', 'a.', '.a', 'a.Get', 'a b.c', ''])('잘못된 이름 %s은 defineOp가 throw', (name) => {
  expect(() => defineOp({ name, access: 'anon', params: z.object({}), run: async () => 1 })).toThrow(/invalid op name/);
});

test.each(['profiles.getMine', 'bank_accounts.list', 'a1.b2'])('올바른 이름 %s', (name) => {
  expect(defineOp({ name, access: 'anon', params: z.object({}), run: async () => 1 }).name).toBe(name);
});
