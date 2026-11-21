import type { DbClient } from './server';

const IN_CHUNK = 1000;

// one-level stand-in for a nested PostgREST embed: rows of `table` whose `col` is in `ids`
export async function selectIn<T>(db: DbClient, table: string, cols: string, col: string, ids: string[]): Promise<T[]> {
  const unique = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data, error } = await db.from(table).select(cols).in(col, unique.slice(i, i + IN_CHUNK));
    if (error) throw new Error(error.message);
    out.push(...(data as T[]));
  }
  return out;
}

export function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}
