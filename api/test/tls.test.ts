import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { readTls } from '../src/tls.js';

// a throwaway self-signed cert made at test time (no key material is committed); /healthz needs no DB
let dir: string;
let app: FastifyInstance;
let port: number;
let cert: Buffer;
const pool = createPool('postgresql://unused@127.0.0.1:1/none');

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bara-tls-'));
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')],
    { stdio: 'ignore' },
  );
  cert = readFileSync(join(dir, 'cert.pem'));
  const config = loadConfig({
    DATABASE_URL: 'postgresql://x',
    BARA_SERVICE_KEY: 'k'.repeat(32),
    TLS_CERT_FILE: join(dir, 'cert.pem'),
    TLS_KEY_FILE: join(dir, 'key.pem'),
  });
  app = buildApp({ config, pool, mailer: new MemoryMailer(), storage: new MemoryStorage(), logger: { level: 'silent' }, https: readTls(config) });
  await app.listen({ port: 0, host: config.host });
  port = (app.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await app?.close();
  await pool.end();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('TLS_CERT_FILE·TLS_KEY_FILE가 있으면 HTTPS로 수신(인증서 고정 검증 통과)', async () => {
  const body = await new Promise<string>((resolve, reject) => {
    const req = httpsRequest({ host: '127.0.0.1', port, path: '/healthz', ca: cert, servername: 'localhost' }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(`${res.statusCode} ${data}`));
    });
    req.on('error', reject);
    req.end();
  });
  expect(body).toBe('200 {"ok":true}');
});

test('다른 CA로는 연결 거절(검증 켜짐)', async () => {
  const err = await new Promise<Error | null>((resolve) => {
    const req = httpsRequest({ host: '127.0.0.1', port, path: '/healthz' }, () => resolve(null));
    req.on('error', resolve);
    req.end();
  });
  expect(err).not.toBeNull();
});

test('평문 HTTP 요청은 처리되지 않는다', async () => {
  const status = await new Promise<number | string>((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/healthz' }, (res) => resolve(res.statusCode ?? 0));
    req.on('error', (e) => resolve(e.message));
    req.end();
  });
  expect(status).not.toBe(200);
});

test('기본 수신 주소는 127.0.0.1', () => {
  expect(app.server.address()).toMatchObject({ address: '127.0.0.1' });
});

test('인증서 파일을 못 읽으면 변수 이름만 담은 문구로 실패', () => {
  const tls = { certFile: join(dir, 'nope.pem'), keyFile: join(dir, 'key.pem') };
  expect(() => readTls({ tls })).toThrow('TLS_CERT_FILE could not be read');
  expect(() => readTls({ tls: { certFile: join(dir, 'cert.pem'), keyFile: join(dir, 'nope.pem') } })).toThrow('TLS_KEY_FILE could not be read');
  expect(readTls({ tls: null })).toBeUndefined();
});
