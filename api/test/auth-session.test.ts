import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;

beforeAll(async () => {
  ctx = await setupTestDb();
  const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });
  app = buildApp({ config, pool: ctx.pool, mailer: new MemoryMailer(), storage: new MemoryStorage() });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

async function newUser(status: 'active' | 'withdrawn' = 'active'): Promise<{ id: string; email: string }> {
  const email = `u${Math.random().toString(36).slice(2)}@example.com`;
  const u = await ctx.adminPool.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
  const id = u.rows[0].id;
  await ctx.adminPool.query("update public.profiles set status = $2 where id = $1", [id, status]);
  return { id, email };
}

const get = (token?: string) =>
  app.inject({
    method: 'GET',
    url: '/v1/auth/session',
    headers: { 'x-bara-service-key': KEY, ...(token === undefined ? {} : { 'x-bara-session': token }) },
  });

test('유효한 세션 → user와 profile(role,status)', async () => {
  const u = await newUser();
  const { token } = await createSession(ctx.pool, u.id, 30);
  const res = await get(token);
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.user.id).toBe(u.id);
  expect(body.user.email).toBe(u.email);
  expect(new Date(body.user.emailConfirmedAt).getTime()).toBeGreaterThan(0);
  expect(body.profile).toEqual({ role: 'learner', status: 'active' });
});

test('프로필이 없는 사용자 → profile null', async () => {
  const r = await ctx.adminPool.query("insert into auth.users (email) values ('np@example.com') returning id");
  await ctx.adminPool.query('delete from public.profiles where id = $1', [r.rows[0].id]);
  const { token } = await createSession(ctx.pool, r.rows[0].id, 30);
  const body = (await get(token)).json();
  expect(body.profile).toBeNull();
  expect(body.user.emailConfirmedAt).toBeNull();
});

test('세션 헤더 없음/틀림/만료 → 401 unauthenticated', async () => {
  const u = await newUser();
  const { token } = await createSession(ctx.pool, u.id, 30);
  await ctx.adminPool.query("update auth.sessions set expires_at = now() - interval '1 minute' where user_id = $1", [u.id]);
  for (const t of [undefined, 'wrong-token', token]) {
    const res = await get(t);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthenticated');
  }
});

test('탈퇴 회원 세션 → 200 이고 profile.status === "withdrawn"', async () => {
  const u = await newUser('withdrawn');
  const { token } = await createSession(ctx.pool, u.id, 30);
  const res = await get(token);
  expect(res.statusCode).toBe(200);
  expect(res.json().profile.status).toBe('withdrawn');
});

test('auth.users가 삭제된 세션 → 401', async () => {
  const u = await newUser();
  const { token } = await createSession(ctx.pool, u.id, 30);
  await ctx.adminPool.query('delete from auth.users where id = $1', [u.id]);
  const res = await get(token);
  expect(res.statusCode).toBe(401);
  expect(res.json().error.code).toBe('unauthenticated');
});
