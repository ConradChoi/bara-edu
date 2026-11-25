import type { FastifyServerOptions } from 'fastify';

export type LogOptions = { level: string; stream?: { write(msg: string): void } };

type ErrLike = { name?: unknown; message?: unknown; code?: unknown; constraint?: unknown; table?: unknown; statusCode?: unknown; stack?: unknown };
type SafeErr = { [key: string]: unknown; type: string; message?: string; stack?: string };

const SQLSTATE = /^[0-9A-Z]{5}$/;

// pg errors carry row values in detail/where/etc., so only an allow-list of fields is logged
export function safeErrSerializer(err: ErrLike): SafeErr {
  const type = typeof err?.name === 'string' ? err.name : 'Error';
  if (typeof err?.code === 'string' && SQLSTATE.test(err.code)) {
    // the pg message and the stack's first line carry row values (e.g. duplicate key text), so only identifiers are kept
    const out: SafeErr = { type, code: err.code };
    if (err.constraint !== undefined) out.constraint = err.constraint;
    if (err.table !== undefined) out.table = err.table;
    if (err.statusCode !== undefined) out.statusCode = err.statusCode;
    return out;
  }
  const out: SafeErr = {
    type,
    message: typeof err?.message === 'string' ? err.message : '',
    stack: typeof err?.stack === 'string' ? err.stack : '',
  };
  if (err?.code !== undefined) out.code = err.code;
  if (err?.statusCode !== undefined) out.statusCode = err.statusCode;
  return out;
}

const SECRET_HEADERS = ['x-bara-service-key', 'x-bara-session', 'x-bara-signup-token'];

export function loggerOptions(opts: LogOptions | undefined): FastifyServerOptions['logger'] {
  if (!opts) return false;
  return {
    level: opts.level,
    ...(opts.stream ? { stream: opts.stream } : {}),
    // fastify's serializer type demands message/stack, which pg errors deliberately omit
    serializers: { err: safeErrSerializer as never, error: safeErrSerializer as never },
    redact: { paths: SECRET_HEADERS.flatMap((h) => [`req.headers["${h}"]`, `headers["${h}"]`]), remove: true },
  };
}
