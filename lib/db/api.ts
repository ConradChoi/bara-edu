import 'server-only';
import { headers } from 'next/headers';
import { getServiceKey } from './service-key';

export type ApiError = { code: string; message: string; sqlstate?: string };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

const TIMEOUT_MS = 10_000;
const UNAVAILABLE: ApiError = { code: 'unavailable', message: '서비스에 일시적으로 연결할 수 없어요.' };
const INTERNAL: ApiError = { code: 'internal', message: '요청을 처리하지 못했어요.' };

async function clientIp(): Promise<string | null> {
  try {
    const first = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}

function parseError(body: unknown): ApiError | null {
  const e = (body as { error?: unknown } | null)?.error as Partial<ApiError> | undefined;
  if (!e || typeof e.code !== 'string' || typeof e.message !== 'string') return null;
  return e.sqlstate ? { code: e.code, message: e.message, sqlstate: e.sqlstate } : { code: e.code, message: e.message };
}

export async function apiFetch<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; session?: string | null; clientIp?: string | null },
): Promise<ApiResult<T>> {
  const base = process.env.BARA_API_URL;
  if (!base) throw new Error('BARA_API_URL is not set');

  const reqHeaders: Record<string, string> = {};
  if (init.session) reqHeaders['x-bara-session'] = init.session;
  // proxy passes the IP itself: next/headers isn't available there
  const ip = init.clientIp !== undefined ? init.clientIp : await clientIp();
  if (ip) reqHeaders['x-bara-client-ip'] = ip;
  if (init.body !== undefined) reqHeaders['content-type'] = 'application/json';

  let res: Response;
  try {
    // an unreadable service key (SSM down, missing parameter) is an outage like an unreachable API, not a crash
    reqHeaders['x-bara-service-key'] = await getServiceKey();
    res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: reqHeaders,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 503, error: UNAVAILABLE };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 본문이 JSON이 아니면 아래에서 상태 코드만으로 판단한다.
  }
  if (res.ok) return { ok: true, data: body as T };
  return { ok: false, status: res.status, error: parseError(body) ?? INTERNAL };
}
