import type pg from 'pg';
import { withService } from '../db/context.js';

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function hit(pool: pg.Pool, bucket: string, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  return withService(pool, async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${bucket}:${key}`]);
    const c = await tx.query<{ n: number }>(
      `select count(*)::int as n from auth.rate_events
        where bucket = $1 and key = $2 and created_at > now() - make_interval(secs => $3::int)`,
      [bucket, key, windowSeconds],
    );
    if (c.rows[0].n >= limit) return false;
    await tx.query('insert into auth.rate_events (bucket, key) values ($1, $2)', [bucket, key]);
    return true;
  });
}
