import type pg from 'pg';
import { withAnon } from '../db/context.js';

export type ForeignKey = { table: string; cols: string[]; refTable: string; refCols: string[] };

export type Relation = { kind: 'one' | 'many'; fromCols: string[]; toCols: string[] };

export type Catalog = {
  columns(table: string): ReadonlySet<string> | undefined;
  relation(from: string, to: string): Relation | undefined;
  isJson(table: string, col: string): boolean;
};

export function makeCatalog(
  columns: ReadonlyMap<string, readonly string[]>,
  fks: readonly ForeignKey[],
  jsonColumns: ReadonlyMap<string, readonly string[]> = new Map(),
): Catalog {
  const cols = new Map([...columns].map(([t, c]) => [t, new Set(c)]));
  const json = new Map([...jsonColumns].map(([t, c]) => [t, new Set(c)]));
  return {
    columns: (table) => cols.get(table),
    isJson: (table, col) => json.get(table)?.has(col) ?? false,
    relation(from, to) {
      const found: Relation[] = [];
      for (const fk of fks) {
        if (fk.table === from && fk.refTable === to) found.push({ kind: 'one', fromCols: fk.cols, toCols: fk.refCols });
        if (fk.table === to && fk.refTable === from) found.push({ kind: 'many', fromCols: fk.refCols, toCols: fk.cols });
      }
      return found.length === 1 ? found[0] : undefined;
    },
  };
}

// runs as the anon session role: bara_edu_app itself has no privileges, and the catalog should list only what session roles can reach
export async function loadCatalog(pool: pg.Pool): Promise<Catalog> {
  return withAnon(pool, async (tx) => {
    const c = await tx.query<{ table_name: string; column_name: string; data_type: string }>(
      `select c.table_name::text, c.column_name::text, c.data_type::text
         from information_schema.columns c
         join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        order by c.table_name, c.ordinal_position`,
    );
    const columns = new Map<string, string[]>();
    const json = new Map<string, string[]>();
    const push = (m: Map<string, string[]>, t: string, col: string) => m.set(t, [...(m.get(t) ?? []), col]);
    for (const r of c.rows) {
      push(columns, r.table_name, r.column_name);
      if (r.data_type === 'json' || r.data_type === 'jsonb') push(json, r.table_name, r.column_name);
    }
    const f = await tx.query<{ table: string; cols: string[]; ref_table: string; ref_cols: string[] }>(
      `select src.relname::text as table, dst.relname::text as ref_table,
              array(select a.attname::text from unnest(k.conkey) with ordinality u(n, i) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.n order by u.i) as cols,
              array(select a.attname::text from unnest(k.confkey) with ordinality u(n, i) join pg_attribute a on a.attrelid = k.confrelid and a.attnum = u.n order by u.i) as ref_cols
         from pg_constraint k
         join pg_class src on src.oid = k.conrelid
         join pg_class dst on dst.oid = k.confrelid
        where k.contype = 'f'
          and src.relnamespace = 'public'::regnamespace
          and dst.relnamespace = 'public'::regnamespace`,
    );
    const fks = f.rows
      .filter((r) => columns.has(r.table) && columns.has(r.ref_table))
      .map((r) => ({ table: r.table, cols: r.cols, refTable: r.ref_table, refCols: r.ref_cols }));
    return makeCatalog(columns, fks, json);
  });
}

export function lazyCatalog(pool: pg.Pool): () => Promise<Catalog> {
  let pending: Promise<Catalog> | null = null;
  return () => {
    pending ??= loadCatalog(pool).catch((err) => {
      pending = null;
      throw err;
    });
    return pending;
  };
}
