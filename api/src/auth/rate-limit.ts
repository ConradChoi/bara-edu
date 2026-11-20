import type pg from 'pg';
import { withService, type Tx } from '../db/context.js';

// must exceed the longest window used (1 hour)
const RETENTION_SECONDS = 24 * 3600;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

async function reserveIn(tx: Tx, bucket: string, key: string, limit: number, windowSeconds: number): Promise<string | null> {
  await tx.query(
    `delete from auth.rate_events where id in (
       select id from auth.rate_events where created_at < now() - make_interval(secs => $1::int)
        limit 200 for update skip locked)`,
    [RETENTION_SECONDS],
  );
  await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${bucket}:${key}`]);
  const c = await tx.query<{ n: number }>(
    `select count(*)::int as n from auth.rate_events
      where bucket = $1 and key = $2 and created_at > now() - make_interval(secs => $3::int)`,
    [bucket, key, windowSeconds],
  );
  if (c.rows[0].n >= limit) return null;
  const ins = await tx.query<{ id: string }>('insert into auth.rate_events (bucket, key) values ($1, $2) returning id', [bucket, key]);
  return ins.rows[0].id;
}

export async function hit(pool: pg.Pool, bucket: string, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  return (await withService(pool, (tx) => reserveIn(tx, bucket, key, limit, windowSeconds))) !== null;
}

export function reserve(pool: pg.Pool, bucket: string, key: string, limit: number, windowSeconds: number): Promise<string | null> {
  return withService(pool, (tx) => reserveIn(tx, bucket, key, limit, windowSeconds));
}

export async function release(pool: pg.Pool, id: string): Promise<void> {
  await withService(pool, (tx) => tx.query('delete from auth.rate_events where id = $1', [id]));
}
