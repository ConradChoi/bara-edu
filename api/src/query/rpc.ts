import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withAnon, withUser, type Tx } from '../db/context.js';
import { sendError } from '../http/errors.js';
import { toDbError } from './db-error.js';

export const RPC_ALLOW = [
  'submit_quiz_attempt',
  'submit_diagnosis_lead',
  'submit_diagnosis',
  'submit_course_exam',
  'set_quiz_correct_option',
  'set_course_exam_correct_option',
  'publish_legal_document',
  'issue_certificate_self',
  'get_quiz_for_lesson',
  'get_my_exam_reset_at',
  'get_my_diagnosis_results',
  'get_diagnosis_summary',
  'get_diagnosis_detail',
  'get_course_exam_readiness',
  'get_course_exam',
  'delete_my_diagnosis_result',
  'claim_diagnosis',
] as const;

// 세션 없이 부르면 DB까지 가지 않고 401 unauthenticated로 답하는 함수(API 계약 C2). 그 밖의 로그인 전용 함수는
// 기존대로 실행 권한 회수(403 42501)로 막는다.
const RPC_LOGIN_REQUIRED: ReadonlySet<string> = new Set(['delete_my_diagnosis_result']);

export type RpcArg = { name: string; type: string; hasDefault: boolean };
export type RpcFn = { name: string; args: RpcArg[]; setof: boolean; isVoid: boolean };
export type RpcCatalog = ReadonlyMap<string, RpcFn>;

export async function loadRpcCatalog(pool: pg.Pool): Promise<RpcCatalog> {
  const rows = await withAnon(pool, async (tx) =>
    (
      await tx.query<{
        proname: string;
        argnames: string[] | null;
        modes: string[] | null;
        types: string[];
        ndefaults: number;
        proretset: boolean;
        ret: string;
      }>(
        `select p.proname::text, p.proargnames as argnames, p.proargmodes::text[] as modes, p.pronargdefaults::int as ndefaults,
                p.proretset, format_type(p.prorettype, null) as ret,
                array(select format_type(t, null) from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality u(t, i) order by i) as types
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])`,
        [RPC_ALLOW],
      )
    ).rows,
  );
  const out = new Map<string, RpcFn>();
  for (const r of rows) {
    if (out.has(r.proname)) throw new Error(`rpc function ${r.proname} has more than one overload`);
    const inputs: { name: string; type: string }[] = [];
    r.types.forEach((type, i) => {
      const mode = r.modes?.[i] ?? 'i';
      if (mode === 'i' || mode === 'b' || mode === 'v') inputs.push({ name: r.argnames?.[i] ?? '', type });
    });
    const firstDefault = inputs.length - r.ndefaults;
    out.set(r.proname, {
      name: r.proname,
      args: inputs.map((a, i) => ({ ...a, hasDefault: i >= firstDefault })),
      setof: r.proretset,
      isVoid: r.ret === 'void',
    });
  }
  for (const name of RPC_ALLOW) if (!out.has(name)) throw new Error(`rpc function ${name} not found in public schema`);
  return out;
}

export function lazyRpcCatalog(pool: pg.Pool): () => Promise<RpcCatalog> {
  let pending: Promise<RpcCatalog> | null = null;
  return () => {
    pending ??= loadRpcCatalog(pool).catch((err) => {
      pending = null;
      throw err;
    });
    return pending;
  };
}

const bodySchema = z.object({ args: z.record(z.string(), z.unknown()).default({}) }).strict();
const isJsonType = (t: string) => t === 'json' || t === 'jsonb';

export class RpcArgError extends Error {}

export function buildRpcCall(fn: RpcFn, args: Record<string, unknown>): { text: string; values: unknown[] } {
  const byName = new Map(fn.args.map((a) => [a.name, a]));
  for (const k of Object.keys(args)) if (!byName.has(k)) throw new RpcArgError();
  const parts: string[] = [];
  const values: unknown[] = [];
  for (const a of fn.args) {
    if (!(a.name in args)) {
      if (!a.hasDefault) throw new RpcArgError();
      continue;
    }
    const v = args[a.name];
    values.push(v !== null && isJsonType(a.type) ? JSON.stringify(v) : v);
    parts.push(`"${a.name}" => $${values.length}::${a.type}`);
  }
  const call = `public."${fn.name}"(${parts.join(', ')})`;
  let text: string;
  if (fn.isVoid) text = `select ${call}`;
  else if (fn.setof) text = `select coalesce(json_agg(t), '[]'::json) as data from ${call} t`;
  else text = `select to_json(${call}) as data`;
  return { text, values };
}

export function registerRpcRoutes(app: FastifyInstance, getCatalog: () => Promise<RpcCatalog>): void {
  app.post<{ Params: { fn: string } }>('/v1/rpc/:fn', async (req, reply) => {
    const cat = await getCatalog();
    const fn = cat.get(req.params.fn);
    if (!fn) return sendError(reply, 'not_found', '요청한 경로를 찾을 수 없습니다.');
    if (RPC_LOGIN_REQUIRED.has(fn.name) && !req.auth.userId) return sendError(reply, 'unauthenticated', '로그인이 필요합니다.');
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendError(reply, 'validation', '요청 형식이 올바르지 않습니다.');
    let call: ReturnType<typeof buildRpcCall>;
    try {
      call = buildRpcCall(fn, parsed.data.args);
    } catch (err) {
      if (err instanceof RpcArgError) return sendError(reply, 'validation', '요청 형식이 올바르지 않습니다.');
      throw err;
    }
    const exec = async (tx: Tx) => {
      await tx.query("set local timezone = 'UTC'");
      const r = await tx.query<{ data?: unknown }>(call.text, call.values);
      return fn.isVoid ? null : (r.rows[0].data ?? null);
    };
    const userId = req.auth.userId;
    try {
      const data = userId ? await withUser(app.deps.pool, userId, exec) : await withAnon(app.deps.pool, exec);
      // 민감정보 동의 철회(결과 셀프 삭제) 처리 사실만 남긴다: 가명 식별자(userId)와 결과·요청 여부. 토큰·점수·이름은 남기지 않는다(API 계약 C2).
      if (fn.name === 'delete_my_diagnosis_result') {
        req.log.info({ event: 'diagnosis_consent_withdrawn', userId, deleted: data === true, deleteLeads: parsed.data.args.p_delete_leads === true }, 'diagnosis result self-delete');
      }
      return { data };
    } catch (err) {
      const mapped = toDbError(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });
}
