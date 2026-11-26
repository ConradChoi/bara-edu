import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { S3Storage } from '../src/storage/s3.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
const storage = new MemoryStorage();

beforeAll(async () => {
  ctx = await setupTestDb();
  app = buildApp({ config, pool: ctx.pool, mailer: new MemoryMailer(), storage });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

async function newUser(name: string, role = 'learner') {
  const u = await ctx.adminPool.query('insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, now(), $2) returning id', [
    `${name}@example.com`,
    { name },
  ]);
  const id = u.rows[0].id as string;
  if (role !== 'learner') {
    const c = await ctx.adminPool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      await c.query('update profiles set role = $2 where id = $1', [id, role]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  const { token } = await createSession(ctx.pool, id, 30, { mfaMethod: 'totp' });
  return { id, token };
}

function post(url: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'x-bara-service-key': KEY };
  if (token) headers['x-bara-session'] = token;
  return app.inject({ method: 'POST', url, headers, payload: body as any });
}
const b64 = (n: number) => Buffer.alloc(n, 1).toString('base64');
const up = (token: string | undefined, over: Record<string, unknown> = {}) =>
  post('/v1/storage/member-photos', { fileName: 'a.png', contentType: 'image/png', dataBase64: b64(10), ...over }, token);

test('본인 경로 업로드 → MemoryStorage에 저장, path 반환', async () => {
  const a = await newUser('alice');
  const r = await up(a.token);
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ path: `${a.id}/a.png` });
  const o = storage.objects.get(`${a.id}/a.png`)!;
  expect(o.contentType).toBe('image/png');
  expect(o.body.length).toBe(10);
  expect((await up(a.token, { dataBase64: b64(20) })).statusCode).toBe(200);
  expect(storage.objects.get(`${a.id}/a.png`)!.body.length).toBe(20);
});

test('5MB 경계: 5MB 통과, 초과·image/gif·잘못된 fileName·잘못된 base64 → 400', async () => {
  const a = await newUser('bobby');
  expect((await up(a.token, { dataBase64: b64(5 * 1024 * 1024) })).statusCode).toBe(200);
  for (const over of [
    { dataBase64: b64(5 * 1024 * 1024 + 1) },
    { contentType: 'image/gif' },
    { contentType: 'image/png; x=1' },
    { fileName: '../x.png' },
    { fileName: 'a/b.png' },
    { fileName: '' },
    { fileName: 'a'.repeat(101) },
    { dataBase64: '!!!notbase64' },
    { dataBase64: 'abc' },
    { dataBase64: '' },
  ]) {
    const r = await up(a.token, over);
    expect(r.statusCode, JSON.stringify(over).slice(0, 60)).toBe(400);
    expect(r.json().error.code).toBe('validation');
  }
});

test('세션 없음 → 401', async () => {
  expect((await up(undefined)).statusCode).toBe(401);
  expect((await post('/v1/storage/member-photos/remove', { path: `${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/a.png` })).statusCode).toBe(401);
  expect((await post('/v1/storage/member-photos/signed-url', { path: 'x' })).statusCode).toBe(401);
});

test('B가 A 경로 signed-url → 403, 관리자 → url, 본인 → url', async () => {
  const a = await newUser('carol');
  const b = await newUser('dave');
  const adm = await newUser('admin1', 'admin');
  await up(a.token);
  const path = `${a.id}/a.png`;
  const rb = await post('/v1/storage/member-photos/signed-url', { path }, b.token);
  expect(rb.statusCode).toBe(403);
  expect(rb.json().error.code).toBe('forbidden');
  const ra = await post('/v1/storage/member-photos/signed-url', { path }, adm.token);
  expect(ra.statusCode).toBe(200);
  expect(ra.json().url).toBe(`memory://${path}?expires=60`);
  expect((await post('/v1/storage/member-photos/signed-url', { path }, a.token)).json().url).toBe(`memory://${path}?expires=60`);
});

test('본인 remove 성공, 남의 경로 remove → 403, 관리자 remove 성공', async () => {
  const a = await newUser('erin');
  const b = await newUser('frank');
  const adm = await newUser('admin2', 'admin');
  await up(a.token);
  const path = `${a.id}/a.png`;
  expect((await post('/v1/storage/member-photos/remove', { path }, b.token)).statusCode).toBe(403);
  expect(storage.objects.has(path)).toBe(true);
  expect((await post('/v1/storage/member-photos/remove', { path }, a.token)).json()).toEqual({ ok: true });
  expect(storage.objects.has(path)).toBe(false);
  await up(a.token);
  expect((await post('/v1/storage/member-photos/remove', { path }, adm.token)).statusCode).toBe(200);
  expect(storage.objects.has(path)).toBe(false);
});

test.each(['a.png', '../x/a.png', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/a.png', `${'0'.repeat(36)}/..`, `${'0'.repeat(36)}/a/b.png`, `${'0'.repeat(36)}/`])(
  '잘못된 path %s → 400',
  async (path) => {
    const a = await newUser(`u${Math.random().toString(36).slice(2, 8)}`);
    expect((await post('/v1/storage/member-photos/remove', { path }, a.token)).statusCode).toBe(400);
    expect((await post('/v1/storage/member-photos/signed-url', { path }, a.token)).statusCode).toBe(400);
  },
);

test('S3Storage: 주입한 클라이언트에 올바른 Bucket/Key/ContentType 명령을 보낸다', async () => {
  const sent: any[] = [];
  const client = { send: async (c: any) => void sent.push(c) } as unknown as S3Client;
  const s = new S3Storage('bkt', 'ap-northeast-2', client);
  await s.put('u/a.png', Buffer.from('x'), 'image/png');
  await s.remove('u/a.png');
  expect(sent[0]).toBeInstanceOf(PutObjectCommand);
  expect(sent[0].input).toMatchObject({ Bucket: 'bkt', Key: 'u/a.png', ContentType: 'image/png' });
  expect(sent[1]).toBeInstanceOf(DeleteObjectCommand);
  expect(sent[1].input).toEqual({ Bucket: 'bkt', Key: 'u/a.png' });
  const local = new S3Client({ region: 'ap-northeast-2', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  const url = new URL(await new S3Storage('bkt', 'ap-northeast-2', local).signedUrl('0123/photo', 60));
  expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
  expect(url.host + url.pathname).toContain('bkt');
  expect(url.pathname).toContain('0123/photo');
});
