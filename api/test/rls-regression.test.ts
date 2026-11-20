import { afterAll, beforeAll, expect, test } from 'vitest';
import { withAnon, withUser } from '../src/db/context.js';
import { setupTestDb } from './helpers/db.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const M = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let ctx: Awaited<ReturnType<typeof setupTestDb>>;

beforeAll(async () => {
  ctx = await setupTestDb();
  for (const [id, name] of [[A, '학습자A'], [B, '학습자B'], [M, '관리자M']]) {
    await ctx.adminPool.query(
      'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)',
      [id, `${name}@example.com`, JSON.stringify({ name })],
    );
  }
  // the protect trigger reverts role changes made by non-admins, so bypass it for seeding
  await ctx.adminPool.query(
    `begin; set local session_replication_role = replica; update profiles set role='admin' where id='${M}'; commit`,
  );
  await ctx.adminPool.query(
    "insert into bank_accounts (bank_name, account_number, account_holder) values ('은행', '123-456', '바라')",
  );
});
afterAll(async () => {
  await ctx.close();
});

test('학습자는 자기 profiles만 본다', async () => {
  const r = await withUser(ctx.pool, A, (tx) => tx.query('select id from profiles'));
  expect(r.rows.map((x) => x.id)).toEqual([A]);
});

test('학습자는 자기 role을 admin으로 못 바꾼다', async () => {
  await withUser(ctx.pool, A, (tx) => tx.query("update profiles set role='admin' where id=$1", [A]));
  const r = await ctx.adminPool.query('select role from profiles where id=$1', [A]);
  expect(r.rows[0].role).toBe('learner');
});

test('익명은 profiles를 한 줄도 못 본다', async () => {
  const r = await withAnon(ctx.pool, (tx) => tx.query('select id from profiles'));
  expect(r.rowCount).toBe(0);
});

test('관리자는 모든 profiles를 본다', async () => {
  const r = await withUser(ctx.pool, M, (tx) => tx.query('select id from profiles'));
  expect(r.rowCount).toBe(3);
});

test('bank_accounts: 로그인 회원은 조회 가능, 익명은 0줄', async () => {
  const user = await withUser(ctx.pool, A, (tx) => tx.query('select id from bank_accounts'));
  expect(user.rowCount).toBe(1);
  const anon = await withAnon(ctx.pool, (tx) => tx.query('select id from bank_accounts'));
  expect(anon.rowCount).toBe(0);
});

test('admin_access_logs: 학습자는 insert 불가', async () => {
  await expect(
    withUser(ctx.pool, A, (tx) =>
      tx.query("insert into admin_access_logs (admin_id, action) values ($1, '조회')", [A]),
    ),
  ).rejects.toMatchObject({ code: expect.stringMatching(/^(42501)$/) });
});
