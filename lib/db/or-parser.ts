export type ScalarOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike';

export type Filter =
  | { col: string; op: ScalarOp; value: string | number | boolean }
  | { col: string; op: 'in'; value: (string | number)[] }
  | { col: string; op: 'is'; value: null | boolean; not?: boolean }
  | { or: Filter[] }
  | { and: Filter[] };

const SCALAR_OPS = new Set<string>(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike']);
const IS_VALUES: Record<string, null | boolean> = { null: null, true: true, false: false };

export class OrParseError extends Error {}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth < 0) throw new OrParseError(`unbalanced ')' in: ${s}`);
    else if (s[i] === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) throw new OrParseError(`unbalanced '(' in: ${s}`);
  parts.push(s.slice(start));
  return parts;
}

function parseItem(item: string): Filter {
  const group = /^(and|or)\((.*)\)$/.exec(item);
  if (group) {
    const list = parseList(group[2]);
    return group[1] === 'and' ? { and: list } : { or: list };
  }
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\.([a-z]+)\.(.+)$/.exec(item);
  if (!m) throw new OrParseError(`cannot parse filter: ${item}`);
  const [, col, op, value] = m;
  if (/[()]/.test(value)) throw new OrParseError(`parenthesis in value: ${item}`);
  if (op === 'is') {
    if (!Object.hasOwn(IS_VALUES, value)) throw new OrParseError(`bad is value: ${item}`);
    return { col, op, value: IS_VALUES[value] };
  }
  if (!SCALAR_OPS.has(op)) throw new OrParseError(`unsupported operator: ${item}`);
  return { col, op: op as ScalarOp, value };
}

function parseList(s: string): Filter[] {
  return splitTopLevel(s).map((item) => {
    if (item === '') throw new OrParseError(`empty filter in: ${s}`);
    return parseItem(item);
  });
}

export function parseOr(s: string): Filter[] {
  return parseList(s);
}
