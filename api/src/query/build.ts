import { z } from 'zod';
import type { Catalog } from './catalog.js';
import { parseSelect, SelectParseError, type SelectNode } from './select-parser.js';

export type Filter =
  | { col: string; op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike'; value: string | number | boolean }
  | { col: string; op: 'in'; value: (string | number)[] }
  | { col: string; op: 'is'; value: null | true | false; not?: boolean }
  | { or: Filter[] }
  | { and: Filter[] };

export type QueryRequest = {
  table: string;
  action: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  select?: string;
  filters?: Filter[];
  order?: { col: string; ascending: boolean }[];
  limit?: number;
  offset?: number;
  single?: 'one' | 'maybe';
  count?: 'exact';
  head?: boolean;
  values?: Record<string, unknown> | Record<string, unknown>[];
  onConflict?: string;
  returning?: boolean;
};

export class QueryError extends Error {}

const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);

export const filterSchema: z.ZodType<Filter> = z.lazy(() =>
  z.union([
    z.object({ col: z.string(), op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike']), value: scalar }).strict(),
    z.object({ col: z.string(), op: z.literal('in'), value: z.array(z.union([z.string(), z.number().finite()])).max(1000) }).strict(),
    z.object({ col: z.string(), op: z.literal('is'), value: z.union([z.null(), z.boolean()]), not: z.boolean().optional() }).strict(),
    z.object({ or: z.array(filterSchema) }).strict(),
    z.object({ and: z.array(filterSchema) }).strict(),
  ]),
);

export const selectRequestSchema = z
  .object({
    table: z.string(),
    action: z.literal('select'),
    select: z.string().optional(),
    filters: z.array(filterSchema).optional(),
    order: z.array(z.object({ col: z.string(), ascending: z.boolean() }).strict()).optional(),
    limit: z.number().int().min(0).max(1000).optional(),
    offset: z.number().int().min(0).optional(),
    single: z.enum(['one', 'maybe']).optional(),
    count: z.literal('exact').optional(),
    head: z.boolean().optional(),
  })
  .strict();

const row = z.record(z.string(), z.unknown());

export const writeRequestSchema = z
  .object({
    table: z.string(),
    action: z.enum(['insert', 'update', 'upsert', 'delete']),
    select: z.string().optional(),
    filters: z.array(filterSchema).optional(),
    values: z.union([row, z.array(row).min(1).max(1000)]).optional(),
    onConflict: z.string().optional(),
    returning: z.boolean().optional(),
    single: z.enum(['one', 'maybe']).optional(),
  })
  .strict();

export const requestSchema = z.union([selectRequestSchema, writeRequestSchema]);

const MAX_FILTER_DEPTH = 4;
const MAX_FILTERS = 100;

// runs before zod: walks raw or/and nesting iteratively so a hostile body cannot blow the stack
export function filtersWithinLimits(body: unknown): boolean {
  const filters = (body as { filters?: unknown } | null)?.filters;
  if (!Array.isArray(filters)) return true;
  if (filters.length > MAX_FILTERS) return false;
  const stack: [unknown, number][] = filters.map((f) => [f, 0]);
  let seen = stack.length;
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (typeof node !== 'object' || node === null) continue;
    for (const key of ['or', 'and'] as const) {
      const list = (node as Record<string, unknown>)[key];
      if (!Array.isArray(list)) continue;
      seen += list.length;
      if (depth >= MAX_FILTER_DEPTH || seen > MAX_FILTERS) return false;
      for (const c of list) stack.push([c, depth + 1]);
    }
  }
  return true;
}

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;
const lit = (name: string) => `'${name.replaceAll("'", "''")}'`;

const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;

function tableColumns(cat: Catalog, table: string): ReadonlySet<string> {
  const cols = cat.columns(table);
  if (!cols) throw new QueryError(`unknown table: ${table}`);
  return cols;
}

function checkCol(cols: ReadonlySet<string>, col: string): string {
  if (!cols.has(col)) throw new QueryError(`unknown column: ${col}`);
  return `t0.${ident(col)}`;
}

function where(cat: Catalog, req: QueryRequest, values: unknown[]): string {
  const cols = tableColumns(cat, req.table);
  const bind = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };
  const one = (f: Filter): string => {
    if ('or' in f || 'and' in f) {
      const list = 'or' in f ? f.or : f.and;
      if (list.length === 0) throw new QueryError('empty or/and');
      return `(${list.map(one).join('or' in f ? ' or ' : ' and ')})`;
    }
    const c = checkCol(cols, f.col);
    switch (f.op) {
      case 'in':
        return `${c} = any(${bind(f.value)})`;
      case 'is':
        return `${c} is ${f.not ? 'not ' : ''}${f.value === null ? 'null' : String(f.value)}`;
      case 'like':
      case 'ilike':
        return `${c}::text ${f.op} ${bind(f.value)}`;
      default:
        return `${c} ${OPS[f.op]} ${bind(f.value)}`;
    }
  };
  const parts = (req.filters ?? []).map(one);
  return parts.length ? ` where ${parts.join(' and ')}` : '';
}

type RelNode = Extract<SelectNode, { kind: 'rel' }>;

function fieldList(cols: ReadonlySet<string>, nodes: SelectNode[], alias: string, rel: (n: RelNode) => string): [string, string][] {
  const out = new Map<string, string>();
  const add = (key: string, expr: string) => {
    if (out.has(key)) throw new QueryError(`duplicate column: ${key}`);
    out.set(key, expr);
  };
  for (const n of nodes) {
    if (n.kind === 'star') for (const c of cols) add(c, `${alias}.${ident(c)}`);
    else if (n.kind === 'col') {
      if (!cols.has(n.name)) throw new QueryError(`unknown column: ${n.name}`);
      add(n.name, `${alias}.${ident(n.name)}`);
    } else add(n.name, rel(n));
  }
  return [...out];
}

function relationExpr(cat: Catalog, from: string, node: RelNode, alias: string): string {
  const rel = cat.relation(from, node.name);
  if (!rel) throw new QueryError(`unknown relation: ${node.name}`);
  const fields = fieldList(tableColumns(cat, node.name), node.children, alias, () => {
    throw new QueryError('nested relation');
  });
  const obj = `json_build_object(${fields.map(([k, e]) => `${lit(k)}, ${e}`).join(', ')})`;
  const on = rel.toCols.map((c, i) => `${alias}.${ident(c)} = t0.${ident(rel.fromCols[i])}`).join(' and ');
  const src = `from "public".${ident(node.name)} ${alias} where ${on}`;
  return rel.kind === 'one' ? `(select ${obj} ${src})` : `coalesce((select json_agg(${obj}) ${src}), '[]'::json)`;
}

function parse(select: string): SelectNode[] {
  try {
    return parseSelect(select);
  } catch (err) {
    if (err instanceof SelectParseError) throw new QueryError(err.message);
    throw err;
  }
}

function selectList(cat: Catalog, req: QueryRequest): string {
  let relIdx = 0;
  const fields = fieldList(tableColumns(cat, req.table), parse(req.select ?? '*'), 't0', (n) => `${relationExpr(cat, req.table, n, `r${++relIdx}`)} as ${ident(n.name)}`);
  return fields.map(([, expr]) => expr).join(', ');
}

const aggregate = (sql: string) => `select coalesce(json_agg(t), '[]'::json) as data from (${sql}) t`;

export function buildSelect(cat: Catalog, req: QueryRequest): { text: string; values: unknown[] } {
  const cols = tableColumns(cat, req.table);
  const list = selectList(cat, req);
  const values: unknown[] = [];
  let sql = `select ${list} from "public".${ident(req.table)} t0${where(cat, req, values)}`;
  if (req.order?.length) sql += ` order by ${req.order.map((o) => `${checkCol(cols, o.col)} ${o.ascending ? 'asc' : 'desc'}`).join(', ')}`;
  if (req.limit !== undefined) {
    values.push(req.limit);
    sql += ` limit $${values.length}`;
  }
  if (req.offset !== undefined) {
    values.push(req.offset);
    sql += ` offset $${values.length}`;
  }
  return { text: aggregate(sql), values };
}

export function buildCount(cat: Catalog, req: QueryRequest): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const w = where(cat, req, values);
  return { text: `select count(*)::int as count from "public".${ident(req.table)} t0${w}`, values };
}

function bindValue(cat: Catalog, table: string, col: string, v: unknown): unknown {
  if (v === null) return null;
  if (cat.isJson(table, col)) {
    try {
      return JSON.stringify(v);
    } catch {
      throw new QueryError(`unserializable json: ${col}`);
    }
  }
  if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') return v;
  throw new QueryError(`object value for non-json column: ${col}`);
}

function writeColumns(cols: ReadonlySet<string>, rows: Record<string, unknown>[]): string[] {
  const out = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) out.add(k);
  if (out.size === 0) throw new QueryError('no columns');
  for (const c of out) if (!cols.has(c)) throw new QueryError(`unknown column: ${c}`);
  return [...out];
}

function conflictColumns(cols: ReadonlySet<string>, spec: string): string[] {
  const list = spec.split(',').map((c) => c.trim());
  if (new Set(list).size !== list.length) throw new QueryError('duplicate onConflict column');
  for (const c of list) if (!cols.has(c)) throw new QueryError(`unknown column: ${c}`);
  return list;
}

export function buildWrite(cat: Catalog, req: QueryRequest): { text: string; values: unknown[] } {
  const cols = tableColumns(cat, req.table);
  const { action } = req;
  const hasFilters = (req.filters?.length ?? 0) > 0;
  if (!req.returning && (req.select !== undefined || req.single)) throw new QueryError('select/single need returning');
  const inserting = action === 'insert' || action === 'upsert';
  if (inserting && req.filters !== undefined) throw new QueryError('filters not allowed');
  if (!inserting && !hasFilters) throw new QueryError('filters required');
  if ((action === 'upsert') !== (req.onConflict !== undefined)) throw new QueryError('onConflict is required for upsert only');
  if ((action === 'delete') !== (req.values === undefined)) throw new QueryError('values required except for delete');

  const values: unknown[] = [];
  const bind = (col: string, v: unknown) => {
    values.push(bindValue(cat, req.table, col, v));
    return `$${values.length}`;
  };
  const target = `"public".${ident(req.table)} as t0`;
  let sql: string;
  if (action === 'insert' || action === 'upsert') {
    const rows = Array.isArray(req.values) ? req.values : [req.values!];
    const names = writeColumns(cols, rows);
    const tuples = rows.map((r) => `(${names.map((c) => (Object.hasOwn(r, c) ? bind(c, r[c]) : 'default')).join(', ')})`);
    sql = `insert into ${target} (${names.map(ident).join(', ')}) values ${tuples.join(', ')}`;
    if (action === 'upsert') {
      const conflict = conflictColumns(cols, req.onConflict!);
      sql += ` on conflict (${conflict.map(ident).join(', ')}) do update set ${names.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`;
    }
  } else if (action === 'update') {
    if (Array.isArray(req.values)) throw new QueryError('update takes one values object');
    const v = req.values!;
    const names = writeColumns(cols, [v]);
    const set = names.map((c) => `${ident(c)} = ${bind(c, v[c])}`).join(', ');
    sql = `update ${target} set ${set}${where(cat, req, values)}`;
  } else if (action === 'delete') {
    sql = `delete from ${target}${where(cat, req, values)}`;
  } else {
    throw new QueryError(`not a write: ${action}`);
  }
  if (!req.returning) return { text: sql, values };
  return { text: `with w as (${sql} returning t0.*) ${aggregate(`select ${selectList(cat, req)} from w t0`)}`, values };
}
