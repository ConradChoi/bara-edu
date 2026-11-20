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

export function buildSelect(cat: Catalog, req: QueryRequest): { text: string; values: unknown[] } {
  const cols = tableColumns(cat, req.table);
  let relIdx = 0;
  const fields = fieldList(cols, parse(req.select ?? '*'), 't0', (n) => `${relationExpr(cat, req.table, n, `r${++relIdx}`)} as ${ident(n.name)}`);
  const list = fields.map(([, expr]) => expr);
  const values: unknown[] = [];
  let sql = `select ${list.join(', ')} from "public".${ident(req.table)} t0${where(cat, req, values)}`;
  if (req.order?.length) sql += ` order by ${req.order.map((o) => `${checkCol(cols, o.col)} ${o.ascending ? 'asc' : 'desc'}`).join(', ')}`;
  if (req.limit !== undefined) {
    values.push(req.limit);
    sql += ` limit $${values.length}`;
  }
  if (req.offset !== undefined) {
    values.push(req.offset);
    sql += ` offset $${values.length}`;
  }
  return { text: `select coalesce(json_agg(t), '[]'::json) as data from (${sql}) t`, values };
}

export function buildCount(cat: Catalog, req: QueryRequest): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const w = where(cat, req, values);
  return { text: `select count(*)::int as count from "public".${ident(req.table)} t0${w}`, values };
}
