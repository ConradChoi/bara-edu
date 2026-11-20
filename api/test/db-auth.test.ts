import { afterAll, beforeAll, expect, test } from 'vitest';
import type pg from 'pg';
import { applyDb } from '../src/db/apply.js';
import { setupTestDb, TEST_APP_PASSWORD } from './helpers/db.js';

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let pool: pg.Pool;
let adminPool: pg.Pool;
const uid = '11111111-1111-1111-1111-111111111111';

beforeAll(async () => {
  ctx = await setupTestDb();
  pool = ctx.pool;
  adminPool = ctx.adminPool;
});
afterAll(async () => {
  await ctx.close();
});

test('auth.uid()는 설정이 없으면 null, 설정하면 그 값', async () => {
  const c = await pool.connect();
  await c.query('begin');
  expect((await c.query('select auth.uid() u, auth.role() r')).rows[0]).toEqual({ u: null, r: 'anon' });
  await c.query("select set_config('request.user_id', $1, true)", [uid]);
  expect((await c.query('select auth.uid() u, auth.role() r')).rows[0]).toEqual({ u: uid, r: 'authenticated' });
  await c.query('rollback');
  c.release();
});

test('bara_edu_authenticated 역할은 auth.users를 읽지 못한다', async () => {
  const c = await pool.connect();
  await c.query('begin');
  await c.query('set local role bara_edu_authenticated');
  await expect(c.query('select * from auth.users')).rejects.toMatchObject({ code: '42501' });
  await c.query('rollback');
  c.release();
});

test('이메일은 대소문자 무시 유니크', async () => {
  await adminPool.query("insert into auth.users (email) values ('A@x.kr')");
  await expect(adminPool.query("insert into auth.users (email) values ('a@x.kr')")).rejects.toMatchObject({ code: '23505' });
});

test('applyDb 두 번 실행해도 성공', async () => {
  const url = new URL(adminPool.options.connectionString!);
  await expect(applyDb(url.toString(), { appPassword: TEST_APP_PASSWORD })).resolves.toBeUndefined();
  await expect(applyDb(url.toString(), { appPassword: TEST_APP_PASSWORD })).resolves.toBeUndefined();
});

test('bara_edu_app 은 NOINHERIT 이고 연결 상한 20', async () => {
  const r = await adminPool.query("select rolinherit, rolconnlimit, rolcanlogin from pg_roles where rolname = 'bara_edu_app'");
  expect(r.rows[0]).toEqual({ rolinherit: false, rolconnlimit: 20, rolcanlogin: true });
});

test('auth 객체 소유자는 bara_edu_service, 금지된 역할 이름은 없다', async () => {
  const t = await adminPool.query("select distinct tableowner from pg_tables where schemaname = 'auth'");
  expect(t.rows).toEqual([{ tableowner: 'bara_edu_service' }]);
  const r = await adminPool.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')");
  expect(r.rows).toEqual([]);
});
