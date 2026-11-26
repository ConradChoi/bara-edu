import { isIP } from 'node:net';
import type pg from 'pg';
import { withService, type Tx } from '../db/context.js';

// must exceed the longest window used (24 hours: already_registered mail cap)
const RETENTION_SECONDS = 25 * 3600;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function reserveIn(tx: Tx, bucket: string, key: string, limit: number, windowSeconds: number): Promise<string | null> {
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

// IP 기반 제한의 키. IPv4와 IPv4-mapped IPv6(::ffff:a.b.c.d)는 IPv4 주소 그대로, IPv6는 앞 64비트(/64)로 묶는다
// (한 사용자가 /64 안에서 주소를 바꿔 가며 제한을 피하지 못하게). 접속 기록(ip_address)에는 원래 IP를 쓰고 이 키는 제한에만 쓴다.
// IP 모양이 아닌 값은 그대로 돌려준다.
export function rateKeyForIp(raw: string): string {
  let s = raw.trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const kind = isIP(s);
  if (kind === 4) return s;
  if (kind !== 6) return raw;
  const groups = expandIpv6(s);
  if (groups === null) return raw;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`;
}

// IPv6 텍스트를 16비트 8개로 펼친다(`::` 축약, 끝의 IPv4 표기 처리). 형식이 틀리면 null.
function expandIpv6(s: string): number[] | null {
  let text = s;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const o = tail.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    text = `${text.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const parts = text.split('::');
  if (parts.length > 2) return null;
  const toNums = (p: string) => (p === '' ? [] : p.split(':').map((h) => parseInt(h, 16)));
  const head = toNums(parts[0]);
  const rest = parts.length === 2 ? toNums(parts[1]) : [];
  const fill = 8 - head.length - rest.length;
  if (parts.length === 1 ? head.length !== 8 : fill < 1) return null;
  const all = parts.length === 1 ? head : [...head, ...Array<number>(fill).fill(0), ...rest];
  return all.length === 8 && all.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? all : null;
}
