export type DbErrorResponse = {
  status: 400 | 403;
  body: { error: { code: 'db_error'; message: string; sqlstate: string } | { code: 'validation'; message: string } };
};

export function toDbError(err: unknown): DbErrorResponse | null {
  if (typeof err !== 'object' || err === null) return null;
  const { code, message } = err as { code?: unknown; message?: unknown };
  if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)) return null;
  const pass = (status: 400 | 403): DbErrorResponse => ({
    status,
    body: { error: { code: 'db_error', message: String(message), sqlstate: code } },
  });
  if (code === '42501') return pass(403);
  if (code === 'P0001' || code.startsWith('23')) return pass(400);
  // data exceptions (bad uuid/number text) and an onConflict without a matching unique index are client errors; the pg message is not exposed
  if (code.startsWith('22') || code === '42P10') return { status: 400, body: { error: { code: 'validation', message: '요청 값이 올바르지 않습니다.' } } };
  return null;
}
