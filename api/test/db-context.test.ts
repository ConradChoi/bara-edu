import { afterAll, beforeAll, expect, test } from 'vitest';
import pg from 'pg';
import { withAnon, withService, withUser } from '../src/db/context.js';
import { setupTestDb, TEST_APP_PASSWORD } from './helpers/db.js';

const userA = '11111111-1111-4111-8111-111111111111';

let ctx: Awaited<ReturnType<typeof setupTestDb>>;

beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => {
  await ctx.close();
});

test('withUser는 authenticated 역할과 auth.uid()를 설정한다', async () => {
  const r = await withUser(ctx.pool, userA, (tx) => tx.query('select auth.uid() u, current_user cu'));
  expect(r.rows[0]).toEqual({ u: userA, cu: 'bara_edu_authenticated' });
  expect(r.rowCount).toBe(1);
});

test('withAnon은 user_id가 없다', async () => {
  const r = await withAnon(ctx.pool, (tx) => tx.query('select auth.uid() u, current_user cu'));
  expect(r.rows[0]).toEqual({ u: null, cu: 'bara_edu_anon' });
});

test('withService 안에서는 current_user가 bara_edu_service', async () => {
  const r = await withService(ctx.pool, (tx) => tx.query('select current_user cu'));
  expect(r.rows[0].cu).toBe('bara_edu_service');
});

test('성공하면 COMMIT, 예외면 ROLLBACK 후 재throw', async () => {
  await withService(ctx.pool, (tx) => tx.query('create table ctx_t (n int)'));
  await withService(ctx.pool, (tx) => tx.query('insert into ctx_t values (1)'));
  await expect(
    withService(ctx.pool, async (tx) => {
      await tx.query('insert into ctx_t values (2)');
      throw new Error('boom');
    }),
  ).rejects.toThrow('boom');
  const r = await ctx.adminPool.query('select n from ctx_t');
  expect(r.rows).toEqual([{ n: 1 }]);
});

test('예외 뒤 같은 연결에 권한·id가 남지 않는다', async () => {
  const one = new pg.Pool({
    connectionString: ctx.pool.options.connectionString,
    max: 1,
  });
  try {
    await expect(
      withUser(one, userA, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const r = await withAnon(one, (tx) => tx.query('select auth.uid() u, current_user cu'));
    expect(r.rows[0]).toEqual({ u: null, cu: 'bara_edu_anon' });
    const after = await one.query('select current_user cu, current_setting(\'request.user_id\', true) u');
    expect(after.rows[0].cu).toBe('bara_edu_app');
    expect(after.rows[0].u || null).toBeNull();
  } finally {
    await one.end();
  }
});

test('UUID가 아닌 userId는 거절', async () => {
  await expect(withUser(ctx.pool, "x'; drop table profiles;--", async () => 1)).rejects.toThrow(/userId/);
});

test('연결을 항상 반환한다', async () => {
  const one = new pg.Pool({ connectionString: ctx.pool.options.connectionString, max: 1 });
  try {
    for (let i = 0; i < 3; i++) {
      await expect(withAnon(one, async () => { throw new Error('x'); })).rejects.toThrow('x');
    }
    await expect(withUser(one, 'bad', async () => 1)).rejects.toThrow(/userId/);
    expect(one.idleCount).toBe(1);
    expect(one.waitingCount).toBe(0);
  } finally {
    await one.end();
  }
});

test('ROLLBACK이 실패한 연결은 풀로 돌려보내지 않고 폐기한다', async () => {
  const one = new pg.Pool({ connectionString: ctx.pool.options.connectionString, max: 1 });
  one.on('error', () => {});
  const releaseArgs: unknown[] = [];
  const origConnect = one.connect.bind(one) as () => Promise<pg.PoolClient>;
  (one as any).connect = async () => {
    const c = await origConnect();
    const origRelease = c.release.bind(c);
    c.release = (arg?: Error | boolean) => {
      releaseArgs.push(arg);
      origRelease(arg);
    };
    return c;
  };
  try {
    let deadPid = 0;
    await expect(
      withUser(one, userA, async (tx) => {
        deadPid = (await tx.query('select pg_backend_pid() pid')).rows[0].pid;
        await ctx.adminPool.query('select pg_terminate_backend($1)', [deadPid]);
        await new Promise((r) => setTimeout(r, 100));
        await tx.query('select 1');
      }),
    ).rejects.toThrow();
    const r = await withAnon(one, (tx) => tx.query('select pg_backend_pid() pid, auth.uid() u, current_user cu'));
    expect(releaseArgs[0]).toBe(true);
    expect(r.rows[0].pid).not.toBe(deadPid);
    expect(r.rows[0]).toMatchObject({ u: null, cu: 'bara_edu_anon' });
    expect(one.totalCount).toBe(1);
  } finally {
    await one.end();
  }
});
