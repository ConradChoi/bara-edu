import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';

const url = 'postgresql://postgres:postgres@127.0.0.1:54329/postgres';
const KEY = 'k'.repeat(32);
const pool = createPool(url);
let app: FastifyInstance;

beforeAll(async () => {
  const config = loadConfig({ DATABASE_URL: url, BARA_SERVICE_KEY: KEY });
  app = buildApp({ config, pool, mailer: undefined });
  app.get('/v1/_boom', async () => {
    throw new Error('pg: secret');
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

test.each([undefined, '', 'wrong-key', 'k'.repeat(31), 'k'.repeat(200)])('서비스 키 %s → 401 unauthorized_service', async (k) => {
  const headers: Record<string, string> = k === undefined ? {} : { 'x-bara-service-key': k };
  const res = await app.inject({ method: 'GET', url: '/v1/auth/session', headers });
  expect(res.statusCode).toBe(401);
  expect(res.json().error.code).toBe('unauthorized_service');
  expect(typeof res.json().error.message).toBe('string');
});

test('길이가 다른 키도 예외 없이 401 (timingSafeEqual 길이 불일치 처리)', async () => {
  const res = await app.inject({ method: 'GET', url: '/v1/_boom', headers: { 'x-bara-service-key': 'short' } });
  expect(res.statusCode).toBe(401);
});

test('존재하지 않는 경로도 키가 없으면 401, 키가 있으면 404 not_found', async () => {
  expect((await app.inject({ method: 'GET', url: '/v1/nope' })).statusCode).toBe(401);
  const res = await app.inject({ method: 'GET', url: '/v1/nope', headers: { 'x-bara-service-key': KEY } });
  expect(res.statusCode).toBe(404);
  expect(res.json().error.code).toBe('not_found');
});

test('/healthz 는 키 없이 200', async () => {
  expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
});

test('500 응답에 내부 오류 문자열이 없다', async () => {
  const res = await app.inject({ method: 'GET', url: '/v1/_boom', headers: { 'x-bara-service-key': KEY } });
  expect(res.statusCode).toBe(500);
  expect(res.json().error.code).toBe('internal');
  expect(res.body).not.toContain('secret');
  expect(res.body).not.toContain('pg:');
});

test('본문 1MB 초과는 400 validation', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/nope',
    headers: { 'x-bara-service-key': KEY, 'content-type': 'application/json' },
    payload: JSON.stringify({ a: 'x'.repeat(1_100_000) }),
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.code).toBe('validation');
});
