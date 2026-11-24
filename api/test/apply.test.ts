import { afterAll, beforeAll, expect, test } from 'vitest';
import pg from 'pg';
import { applyBootstrap, applyMigrations } from '../src/db/apply.js';
import { setupTestDb, TEST_APP_PASSWORD } from './helpers/db.js';

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let adminUrl: string;

beforeAll(async () => {
  ctx = await setupTestDb();
  adminUrl = ctx.adminPool.options.connectionString!;
});
afterAll(async () => {
  await ctx.close();
});

// scram verifiers carry a random salt, so an identical string means the password was not set again
const verifier = async () => (await ctx.adminPool.query("select rolpassword from pg_authid where rolname = 'bara_edu_app'")).rows[0].rolpassword as string;

async function canLogin(password: string): Promise<boolean> {
  const url = new URL(adminUrl);
  url.username = 'bara_edu_app';
  url.password = password;
  const c = new pg.Client({ connectionString: url.toString() });
  try {
    await c.connect();
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => undefined);
  }
}

test('db:migrate를 두 번 실행해도 bara_edu_app 비밀번호는 그대로이고 로그인된다', async () => {
  const before = await verifier();
  await applyMigrations(adminUrl);
  await applyMigrations(adminUrl);
  expect(await verifier()).toBe(before);
  expect(await canLogin(TEST_APP_PASSWORD)).toBe(true);
});

test('db:bootstrap은 비밀번호 인자가 없으면 비밀번호를 바꾸지 않는다', async () => {
  const before = await verifier();
  await applyBootstrap(adminUrl);
  expect(await verifier()).toBe(before);
  expect(await canLogin(TEST_APP_PASSWORD)).toBe(true);
});

test('db:bootstrap은 비밀번호가 주어지면 설정한다', async () => {
  const before = await verifier();
  await applyBootstrap(adminUrl, { appPassword: TEST_APP_PASSWORD });
  expect(await verifier()).not.toBe(before);
  expect(await canLogin(TEST_APP_PASSWORD)).toBe(true);
});

test('db:bootstrap은 역할만 다룬다(스키마 파일을 실행하지 않는다)', async () => {
  const name = `bara_boot_${Date.now().toString(36)}`;
  await ctx.adminPool.query(`create database ${name}`);
  try {
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    await applyBootstrap(url.toString());
    const c = new pg.Client({ connectionString: url.toString() });
    await c.connect();
    const r = await c.query("select count(*)::int as n from pg_namespace where nspname = 'auth'");
    await c.end();
    expect(r.rows[0].n).toBe(0);
  } finally {
    await ctx.adminPool.query(`drop database ${name} with (force)`);
  }
});
