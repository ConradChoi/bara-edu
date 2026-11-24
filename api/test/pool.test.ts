import { afterAll, expect, test } from 'vitest';
import pg from 'pg';
import { createPool, POOL_ERROR_MESSAGE } from '../src/db/pool.js';

const url = process.env.TEST_ADMIN_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/postgres';
const lines: string[] = [];
const pool = createPool(url, (l) => lines.push(l));
afterAll(() => pool.end());

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('연결 대기 시간 제한이 설정돼 있다', () => {
  expect((pool as unknown as { options: { connectionTimeoutMillis: number } }).options.connectionTimeoutMillis).toBe(5000);
});

test('유휴 연결이 끊겨도 프로세스가 죽지 않고 코드만 로그, 다음 쿼리는 새 연결로 성공', async () => {
  const client = await pool.connect();
  const pid = (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
  client.release(); // now idle in the pool

  const killer = new pg.Client({ connectionString: url });
  await killer.connect();
  await killer.query('select pg_terminate_backend($1)', [pid]);
  await killer.end();

  await waitFor(() => lines.length > 0);
  expect(lines[0]).toBe(`${POOL_ERROR_MESSAGE} (57P01)`);
  const r = await pool.query<{ ok: number }>('select 1 as ok');
  expect(r.rows[0]!.ok).toBe(1);
});
