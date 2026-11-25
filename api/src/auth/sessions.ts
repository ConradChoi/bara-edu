import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { withService, type Tx } from '../db/context.js';

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(pool: pg.Pool, userId: string, ttlDays: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const r = await withService(pool, (tx) =>
    tx.query<{ expires_at: Date }>(
      `insert into auth.sessions (token_hash, user_id, expires_at)
       values ($1, $2, now() + make_interval(days => $3::int)) returning expires_at`,
      [sha256(token), userId, ttlDays],
    ),
  );
  return { token, expiresAt: r.rows[0].expires_at };
}

export async function resolveSession(pool: pg.Pool, token: string, ttlDays: number): Promise<{ userId: string; expiresAt: Date; renewed: boolean } | null> {
  return withService(pool, async (tx) => {
    const r = await tx.query<{ user_id: string; expires_at: Date }>(
      'select user_id, expires_at from auth.sessions where token_hash = $1 and expires_at > now()',
      [sha256(token)],
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    const halfMs = (ttlDays * 86_400_000) / 2;
    if (row.expires_at.getTime() - Date.now() < halfMs) {
      const u = await tx.query<{ expires_at: Date }>(
        'update auth.sessions set expires_at = now() + make_interval(days => $2::int) where token_hash = $1 returning expires_at',
        [sha256(token), ttlDays],
      );
      if (u.rowCount === 0) return null;
      return { userId: row.user_id, expiresAt: u.rows[0].expires_at, renewed: true };
    }
    return { userId: row.user_id, expiresAt: row.expires_at, renewed: false };
  });
}

export async function revokeSession(pool: pg.Pool, token: string): Promise<void> {
  await withService(pool, (tx) => tx.query('delete from auth.sessions where token_hash = $1', [sha256(token)]));
}

export async function revokeAllSessions(pool: pg.Pool, userId: string): Promise<void> {
  await withService(pool, (tx) => tx.query('delete from auth.sessions where user_id = $1', [userId]));
}

export async function revokeOtherSessionsIn(tx: Tx, userId: string, keepToken: string): Promise<void> {
  await tx.query('delete from auth.sessions where user_id = $1 and token_hash <> $2', [userId, sha256(keepToken)]);
}

export async function revokeAllSessionsIn(tx: Tx, userId: string): Promise<void> {
  await tx.query('delete from auth.sessions where user_id = $1', [userId]);
}
