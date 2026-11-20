import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';

const url = 'postgresql://postgres:postgres@127.0.0.1:54329/postgres';
const pool = createPool(url);
let app: FastifyInstance;

beforeAll(async () => {
  const config = loadConfig({ DATABASE_URL: url, BARA_SERVICE_KEY: 'k'.repeat(32) });
  app = buildApp({ config, pool, mailer: undefined });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

test('GET /healthz 는 서비스 키 없이 200 {ok:true}', async () => {
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
});
