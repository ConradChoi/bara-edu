export type DbErrorResponse = {
  status: 400 | 403;
  body:
    | { error: { code: 'db_error'; message: string; sqlstate: string } }
    | { error: { code: 'validation'; message: string; field?: string; reason?: string } };
};

// submit_diagnosis()의 동의 검사 예외(P0001)를 앱이 구분할 수 있는 400 validation으로 바꾼다
// (docs/02-design/features/bara-edu-lms.diagnosis-sensitive-consent.md "API 계약" C1).
//  - field 'consent'         -> 앱 ?error=consent-required (SC-ERR-CONSENT). reason은 어느 동의가 빠졌는지(privacy | sensitive).
//  - field 'consent_version' -> 앱 ?error=consent-outdated (SC-ERR-OUTDATED).
const CONSENT_ERRORS: Record<string, { field: string; reason?: string; message: string }> = {
  'privacy consent required': { field: 'consent', reason: 'privacy', message: '동의가 필요합니다.' },
  'sensitive consent required': { field: 'consent', reason: 'sensitive', message: '동의가 필요합니다.' },
  'sensitive consent version mismatch': { field: 'consent_version', message: '동의 안내가 바뀌었습니다. 다시 동의해 주세요.' },
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
  if (code === 'P0001') {
    const consent = CONSENT_ERRORS[String(message)];
    if (consent) return { status: 400, body: { error: { code: 'validation', ...consent } } };
  }
  if (code === 'P0001' || code.startsWith('23')) return pass(400);
  // data exceptions (bad uuid/number text) and an onConflict without a matching unique index are client errors; the pg message is not exposed
  if (code.startsWith('22') || code === '42P10') return { status: 400, body: { error: { code: 'validation', message: '요청 값이 올바르지 않습니다.' } } };
  return null;
}
