import type { z } from 'zod';
import type { Tx } from '../db/context.js';
import type { ErrorCode } from '../http/errors.js';
import type { MailMessage } from '../mail/mailer.js';

export type OpAccess = 'anon' | 'user' | 'service';

// ip: 앱이 넘긴 x-bara-client-ip(없으면 null). queueMail: 트랜잭션이 커밋된 뒤에만 메일을 대기열에 넣는다(롤백되면 보내지 않는다, 실패해도 오퍼레이션 결과에 영향 없음).
// siteOrigin: 메일 링크에 쓰는 이 사이트의 주소(API 설정, 클라이언트 입력 아님).
export type OpContext = { tx: Tx; userId: string | null; ip: string | null; siteOrigin: string; queueMail(msg: MailMessage): void };

// 오퍼레이션이 던지면 트랜잭션은 롤백되고 이 코드·메시지로 응답한다(예: 접속 기록 실패 -> 503).
export class OpError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
  }
}

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
