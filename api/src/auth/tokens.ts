import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { withService, type Tx } from '../db/context.js';

export type TokenPurpose = 'confirm' | 'recovery';

const TTL_SECONDS: Record<TokenPurpose, number> = { confirm: 24 * 3600, recovery: 3600 };

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

export async function issueEmailToken(pool: pg.Pool, userId: string, purpose: TokenPurpose): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await withService(pool, (tx) =>
    tx.query(
      `insert into auth.email_tokens (token_hash, user_id, purpose, expires_at)
       values ($1, $2, $3, now() + make_interval(secs => $4::int))`,
      [sha256(token), userId, purpose, TTL_SECONDS[purpose]],
    ),
  );
  return token;
}

export async function consumeEmailTokenIn(tx: Tx, token: string, purpose: TokenPurpose): Promise<string | null> {
  const r = await tx.query<{ user_id: string }>(
    `update auth.email_tokens set used_at = now()
      where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
      returning user_id`,
    [sha256(token), purpose],
  );
  return r.rowCount === 0 ? null : r.rows[0].user_id;
}

export function consumeEmailToken(pool: pg.Pool, token: string, purpose: TokenPurpose): Promise<string | null> {
  return withService(pool, (tx) => consumeEmailTokenIn(tx, token, purpose));
}
