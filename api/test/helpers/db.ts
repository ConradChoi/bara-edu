import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { applyDb } from '../../src/db/apply.js';

const ADMIN_URL = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:54329/postgres';
export const TEST_APP_PASSWORD = 'bara-test-app-pw';

function withDb(url: string, db: string, user?: string, password?: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

export async function setupTestDb(): Promise<{ pool: pg.Pool; adminPool: pg.Pool; close(): Promise<void> }> {
  const dbName = `bara_test_${randomBytes(6).toString('hex')}`;
  const root = new pg.Client({ connectionString: ADMIN_URL });
  await root.connect();
  await root.query(`create database ${dbName}`);
  await root.end();

  const adminUrl = withDb(ADMIN_URL, dbName);
  await applyDb(adminUrl, { appPassword: TEST_APP_PASSWORD });
  const adminPool = new pg.Pool({ connectionString: adminUrl, max: 4 });
  const pool = new pg.Pool({ connectionString: withDb(ADMIN_URL, dbName, 'bara_edu_app', TEST_APP_PASSWORD), max: 4 });

  return {
    pool,
    adminPool,
    async close() {
      await pool.end();
      await adminPool.end();
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`drop database if exists ${dbName} with (force)`);
      await c.end();
    },
  };
}
