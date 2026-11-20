import { afterAll, beforeAll, expect, test } from 'vitest';
import { hit } from '../src/auth/rate-limit.js';
import { setupTestDb } from './helpers/db.js';

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => {
  await ctx.close();
});

test('limit 3: 네 번째 hit은 false, 창이 지나면 다시 true', async () => {
  for (let i = 0; i < 3; i++) expect(await hit(ctx.pool, 'b', 'k1', 3, 60)).toBe(true);
  expect(await hit(ctx.pool, 'b', 'k1', 3, 60)).toBe(false);
  expect(await hit(ctx.pool, 'b', 'other', 3, 60)).toBe(true);
  await ctx.adminPool.query("update auth.rate_events set created_at = now() - interval '61 seconds' where bucket = 'b' and key = 'k1'");
  expect(await hit(ctx.pool, 'b', 'k1', 3, 60)).toBe(true);
});

test('동시 호출에도 한도를 넘기지 않는다', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => hit(ctx.pool, 'c', 'k', 3, 60)));
  expect(results.filter(Boolean)).toHaveLength(3);
});
