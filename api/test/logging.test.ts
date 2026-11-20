import { afterAll, beforeAll, expect, test } from 'vitest';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
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
  app = buildApp({ config, pool: ctx.pool, mailer: new MemoryMailer(), logger: { level: 'info', stream: { write: (l: string) => void lines.push(l) } } }, [dup]);
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
