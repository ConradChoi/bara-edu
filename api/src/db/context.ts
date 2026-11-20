import type pg from 'pg';

export type Tx = {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
};

type Role = 'bara_edu_anon' | 'bara_edu_authenticated' | 'bara_edu_service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function run<T>(pool: pg.Pool, role: Role, userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (userId !== null && !UUID_RE.test(userId)) throw new Error('userId must be a UUID');
  const client = await pool.connect();
  let broken = false;
  const onError = () => {
    broken = true;
  };
  client.on('error', onError);
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    if (userId !== null) await client.query("select set_config('request.user_id', $1, true)", [userId]);
    const tx: Tx = {
      async query(sql, params) {
        const r = await client.query(sql, params as any[]);
        return { rows: r.rows, rowCount: r.rowCount ?? 0 };
      },
    };
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      broken = true;
    }
    throw err;
  } finally {
    client.off('error', onError);
    client.release(broken);
  }
}

export function withUser<T>(pool: pg.Pool, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return run(pool, 'bara_edu_authenticated', userId, fn);
}

export function withAnon<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return run(pool, 'bara_edu_anon', null, fn);
}

export function withService<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return run(pool, 'bara_edu_service', null, fn);
}
