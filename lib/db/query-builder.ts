import type { ApiError, ApiResult } from './api';
import { parseOr, type Filter, type ScalarOp } from './or-parser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows stay untyped, as with the previous untyped supabase client
export type Row = any;
export type DbError = { code: string; message: string };
export type QueryResult<D> = { data: D | null; error: DbError | null; count: number | null };
export type RpcResult = { data: Row; error: DbError | null };
export type Send = (path: string, body: unknown) => Promise<ApiResult<unknown>>;

type Value = string | number | boolean;
type Values = Record<string, unknown> | Record<string, unknown>[];

type QueryRequest = {
  table: string;
  action: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  select?: string;
  filters: Filter[];
  order: { col: string; ascending: boolean }[];
  limit?: number;
  offset?: number;
  single?: 'one' | 'maybe';
  count?: 'exact';
  head?: boolean;
  values?: Values;
  onConflict?: string;
  returning?: boolean;
};

const PGRST116: DbError = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' };

export function toDbError(e: ApiError): DbError {
  return { code: e.sqlstate ?? e.code, message: e.message };
}

// the API embeds one relation level only; fail at the call site instead of as an opaque 400
function checkSelect(cols: string): string {
  let depth = 0;
  for (const c of cols) {
    if (c === '(' && ++depth > 1) throw new Error(`nested embed is not supported by the API: select('${cols}')`);
    if (c === ')') depth--;
  }
  return cols;
}

function wireBody({ filters, order, ...rest }: QueryRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { ...rest };
  if (filters.length) body.filters = filters;
  if (order.length) body.order = order;
  return body;
}

class ResultBuilder<D> implements PromiseLike<QueryResult<D>> {
  constructor(
    protected readonly send: Send,
    protected readonly req: QueryRequest,
  ) {}

  private async execute(): Promise<QueryResult<D>> {
    const r = await this.send('/v1/query', wireBody(this.req));
    if (!r.ok) return { data: null, error: toDbError(r.error), count: null };
    const { data, count } = r.data as { data: D | null; count?: number | null };
    return { data, error: null, count: count ?? null };
  }

  then<A = QueryResult<D>, B = never>(
    onfulfilled?: ((value: QueryResult<D>) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export class FilterBuilder extends ResultBuilder<Row[]> {
  private push(f: Filter): this {
    this.req.filters.push(f);
    return this;
  }

  private scalar(op: ScalarOp, col: string, value: Value): this {
    return this.push({ col, op, value });
  }

  eq(col: string, value: Value): this {
    return this.scalar('eq', col, value);
  }
  neq(col: string, value: Value): this {
    return this.scalar('neq', col, value);
  }
  gt(col: string, value: Value): this {
    return this.scalar('gt', col, value);
  }
  gte(col: string, value: Value): this {
    return this.scalar('gte', col, value);
  }
  lt(col: string, value: Value): this {
    return this.scalar('lt', col, value);
  }
  lte(col: string, value: Value): this {
    return this.scalar('lte', col, value);
  }
  like(col: string, pattern: string): this {
    return this.scalar('like', col, pattern);
  }
  ilike(col: string, pattern: string): this {
    return this.scalar('ilike', col, pattern);
  }
  in(col: string, values: readonly (string | number)[]): this {
    return this.push({ col, op: 'in', value: [...values] });
  }
  is(col: string, value: null | boolean): this {
    return this.push({ col, op: 'is', value });
  }
  not(col: string, op: 'is', value: null): this {
    return this.push({ col, op, value, not: true });
  }
  or(filters: string): this {
    return this.push({ or: parseOr(filters) });
  }

  order(col: string, opts: { ascending: boolean }): this {
    this.req.order.push({ col, ascending: opts.ascending });
    return this;
  }
  limit(n: number): this {
    this.req.limit = n;
    return this;
  }
  range(from: number, to: number): this {
    this.req.offset = from;
    this.req.limit = to - from + 1;
    return this;
  }

  select(cols = '*'): this {
    this.req.select = checkSelect(cols);
    if (this.req.action !== 'select') this.req.returning = true;
    return this;
  }

  single(): ResultBuilder<Row> {
    return new ResultBuilder<Row>(this.send, { ...this.req, single: 'one' });
  }
  maybeSingle(): ResultBuilder<Row> {
    return new ResultBuilder<Row>(this.send, { ...this.req, single: 'maybe' });
  }
}

export class TableBuilder {
  constructor(
    private readonly send: Send,
    private readonly table: string,
  ) {}

  private start(action: QueryRequest['action'], extra: Partial<QueryRequest> = {}): FilterBuilder {
    return new FilterBuilder(this.send, { table: this.table, action, filters: [], order: [], ...extra });
  }

  select(cols = '*', opts: { count?: 'exact'; head?: boolean } = {}): FilterBuilder {
    return this.start('select', { select: checkSelect(cols), ...opts });
  }
  insert(values: Values): FilterBuilder {
    return this.start('insert', { values });
  }
  update(values: Record<string, unknown>): FilterBuilder {
    return this.start('update', { values });
  }
  upsert(values: Values, opts: { onConflict: string }): FilterBuilder {
    return this.start('upsert', { values, onConflict: opts.onConflict });
  }
  delete(): FilterBuilder {
    return this.start('delete');
  }
}

export class RpcBuilder implements PromiseLike<RpcResult> {
  constructor(
    private readonly send: Send,
    private readonly fn: string,
    private readonly args: Record<string, unknown>,
    private readonly mode?: 'one' | 'maybe',
  ) {}

  private async execute(): Promise<RpcResult> {
    const r = await this.send(`/v1/rpc/${encodeURIComponent(this.fn)}`, { args: this.args });
    if (!r.ok) return { data: null, error: toDbError(r.error) };
    const { data } = r.data as { data: Row };
    // single/maybeSingle over a set-returning function narrow the row array client-side, as PostgREST does
    if (!this.mode || !Array.isArray(data)) return { data, error: null };
    if (data.length > 1 || (data.length === 0 && this.mode === 'one')) return { data: null, error: PGRST116 };
    return { data: data[0] ?? null, error: null };
  }

  then<A = RpcResult, B = never>(
    onfulfilled?: ((value: RpcResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }

  single(): PromiseLike<RpcResult> {
    return new RpcBuilder(this.send, this.fn, this.args, 'one');
  }
  maybeSingle(): PromiseLike<RpcResult> {
    return new RpcBuilder(this.send, this.fn, this.args, 'maybe');
  }
}
