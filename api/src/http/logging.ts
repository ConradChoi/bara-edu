import type { FastifyServerOptions } from 'fastify';

export type LogOptions = { level: string; stream?: { write(msg: string): void } };

type ErrLike = { name?: unknown; message?: unknown; code?: unknown; statusCode?: unknown; stack?: unknown };
type SafeErr = { [key: string]: unknown; type: string; message: string; stack: string };

// pg errors carry row values in detail/where/etc., so only an allow-list of fields is logged
export function safeErrSerializer(err: ErrLike): SafeErr {
  const out: SafeErr = {
    type: typeof err?.name === 'string' ? err.name : 'Error',
    message: typeof err?.message === 'string' ? err.message : '',
    stack: typeof err?.stack === 'string' ? err.stack : '',
  };
  if (err?.code !== undefined) out.code = err.code;
  if (err?.statusCode !== undefined) out.statusCode = err.statusCode;
  return out;
}

const SECRET_HEADERS = ['x-bara-service-key', 'x-bara-session'];

export function loggerOptions(opts: LogOptions | undefined): FastifyServerOptions['logger'] {
  if (!opts) return false;
  return {
    level: opts.level,
    ...(opts.stream ? { stream: opts.stream } : {}),
    serializers: { err: safeErrSerializer, error: safeErrSerializer },
    redact: { paths: SECRET_HEADERS.flatMap((h) => [`req.headers["${h}"]`, `headers["${h}"]`]), remove: true },
  };
}
