import pg from 'pg';

export const POOL_ERROR_MESSAGE = 'pg pool: idle client error';

// An idle client whose connection drops (DB restart, failover, network) emits 'error' on the pool;
// without a listener Node crashes the process. The pool discards that client and the next query reconnects.
// Only the error code is logged: pg messages can carry hosts or values.
export function createPool(databaseUrl: string, log: (line: string) => void = (l) => console.error(l)): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 5000 });
  pool.on('error', (err) => log(`${POOL_ERROR_MESSAGE} (${(err as { code?: string }).code ?? 'no code'})`));
  return pool;
}
