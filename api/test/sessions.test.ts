import { afterAll, beforeAll, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { createSession, resolveSession, revokeAllSessions, revokeSession } from '../src/auth/sessions.js';
import { setupTestDb } from './helpers/db.js';

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
const DAY = 86_400_000;

beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => {
  await ctx.close();
});

async function newUser(): Promise<string> {
  const r = await ctx.adminPool.query(
    "insert into auth.users (email) values ($1) returning id",
    [`u${Math.random().toString(36).slice(2)}@example.com`],
  );
  return r.rows[0].id;
}

test('발급한 토큰으로 조회되고 DB에는 평문 토큰이 없다', async () => {
  const userId = await newUser();
  const { token, expiresAt } = await createSession(ctx.pool, userId, 30);
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);

  const found = await resolveSession(ctx.pool, token, 30);
  expect(found?.userId).toBe(userId);

  const rows = (await ctx.adminPool.query('select token_hash from auth.sessions where user_id = $1', [userId])).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
  expect(rows[0].token_hash).not.toContain(token);
});

test('모르는 토큰은 null', async () => {
  expect(await resolveSession(ctx.pool, 'nope', 30)).toBeNull();
});

test('만료된 세션은 null', async () => {
  const userId = await newUser();
  const { token } = await createSession(ctx.pool, userId, 30);
  await ctx.adminPool.query("update auth.sessions set expires_at = now() - interval '1 second' where user_id = $1", [userId]);
  expect(await resolveSession(ctx.pool, token, 30)).toBeNull();
});

test('남은 기간이 절반 미만이면 연장된다', async () => {
  const userId = await newUser();
  const { token } = await createSession(ctx.pool, userId, 30);
  await ctx.adminPool.query("update auth.sessions set expires_at = now() + interval '10 days' where user_id = $1", [userId]);
  const found = await resolveSession(ctx.pool, token, 30);
  expect(found!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
  const row = (await ctx.adminPool.query('select expires_at from auth.sessions where user_id = $1', [userId])).rows[0];
  expect(row.expires_at.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
});

test('남은 기간이 절반 이상이면 연장하지 않는다', async () => {
  const userId = await newUser();
  const { token } = await createSession(ctx.pool, userId, 30);
  await ctx.adminPool.query("update auth.sessions set expires_at = now() + interval '20 days' where user_id = $1", [userId]);
  const found = await resolveSession(ctx.pool, token, 30);
  expect(found!.expiresAt.getTime()).toBeLessThan(Date.now() + 21 * DAY);
});

test('revokeSession은 해당 토큰만 지운다', async () => {
  const userId = await newUser();
  const a = await createSession(ctx.pool, userId, 30);
  const b = await createSession(ctx.pool, userId, 30);
  await revokeSession(ctx.pool, a.token);
  expect(await resolveSession(ctx.pool, a.token, 30)).toBeNull();
  expect(await resolveSession(ctx.pool, b.token, 30)).not.toBeNull();
});

test('revokeAllSessions 뒤에는 모든 토큰이 null', async () => {
  const userId = await newUser();
  const other = await newUser();
  const a = await createSession(ctx.pool, userId, 30);
  const b = await createSession(ctx.pool, userId, 30);
  const o = await createSession(ctx.pool, other, 30);
  await revokeAllSessions(ctx.pool, userId);
  expect(await resolveSession(ctx.pool, a.token, 30)).toBeNull();
  expect(await resolveSession(ctx.pool, b.token, 30)).toBeNull();
  expect(await resolveSession(ctx.pool, o.token, 30)).not.toBeNull();
});

test('회원이 삭제되면 세션도 사라진다(cascade)', async () => {
  const userId = await newUser();
  const { token } = await createSession(ctx.pool, userId, 30);
  await ctx.adminPool.query('delete from auth.users where id = $1', [userId]);
  expect(await resolveSession(ctx.pool, token, 30)).toBeNull();
  const r = await ctx.adminPool.query('select 1 from auth.sessions where user_id = $1', [userId]);
  expect(r.rowCount).toBe(0);
});

test('연장 직전에 다른 트랜잭션이 세션을 지우면 throw 대신 null', async () => {
  const userId = await newUser();
  const { token } = await createSession(ctx.pool, userId, 30);
  const hash = createHash('sha256').update(token).digest('hex');
  await ctx.adminPool.query("update auth.sessions set expires_at = now() + interval '1 day' where token_hash = $1", [hash]);
  const c = await ctx.adminPool.connect();
  try {
    await c.query('begin');
    await c.query('delete from auth.sessions where token_hash = $1', [hash]);
    const pending = resolveSession(ctx.pool, token, 30);
    for (let i = 0; i < 100; i++) {
      const w = await ctx.adminPool.query("select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'");
      if (w.rows[0].n > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await c.query('commit');
    await expect(pending).resolves.toBeNull();
  } finally {
    c.release();
  }
});
