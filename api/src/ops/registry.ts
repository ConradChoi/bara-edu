import type { z } from 'zod';
import type { Tx } from '../db/context.js';

export type OpAccess = 'anon' | 'user' | 'service';

export type OpContext = { tx: Tx; userId: string | null };

export type Op<P = any, R = any> = {
  name: string;
  access: OpAccess;
  params: z.ZodType<P, z.ZodTypeDef, unknown>;
  run(ctx: OpContext, params: P): Promise<R>;
};

export type Registry = ReadonlyMap<string, Op>;

const NAME_RE = /^[a-z][a-z0-9_]*\.[a-z][A-Za-z0-9]*$/;

export function defineOp<P, R>(def: {
  name: string;
  access: OpAccess;
  params: z.ZodType<P, z.ZodTypeDef, unknown>;
  run(ctx: OpContext, params: P): Promise<R>;
}): Op<P, R> {
  if (!NAME_RE.test(def.name)) throw new Error(`invalid op name: ${def.name}`);
  return def;
}

export function registerOps(ops: Op[]): Registry {
  const map = new Map<string, Op>();
  for (const op of ops) {
    if (map.has(op.name)) throw new Error(`duplicate op name: ${op.name}`);
    map.set(op.name, op);
  }
  return map;
}
