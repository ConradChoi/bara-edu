import 'server-only';
import { headers } from 'next/headers';
import { clientIpFrom } from './client-ip';
import { getServiceKey } from './service-key';

// field: 400 validation에서 문제가 된 입력 칸(email, password, name, phone, currentPassword, token, origin, reason)
// attemptsLeft: 403 wrong_password(가입 링크 비밀번호 불일치)·2단계 인증 wrong_code 등에서 남은 횟수
// lockScope·retryAfterMinutes: 429 mfa_locked(2단계 인증 계정 잠김, 기획서 4.0)
// ticketVerified: 404 no_enrollment(로그인 중 등록, 4.4.3) / reason: 401 session_expired의 max·idle(4.9)
export type ApiError = {
  code: string;
  message: string;
  sqlstate?: string;
  field?: string;
  attemptsLeft?: number;
  lockScope?: 'account' | 'daily';
  retryAfterMinutes?: number;
  ticketVerified?: boolean;
  reason?: string;
};
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

const TIMEOUT_MS = 10_000;
const UNAVAILABLE: ApiError = { code: 'unavailable', message: '서비스에 일시적으로 연결할 수 없어요.' };
const INTERNAL: ApiError = { code: 'internal', message: '요청을 처리하지 못했어요.' };

// 프리페치 요청(Next 라우터·브라우저)인지. 관리자 1시간 미사용 판정에서 프리페치는 "사용"이 아니다(기획서 2.3, 4.11 D-17).
export function isPrefetchRequest(get: (name: string) => string | null): boolean {
  if (get('next-router-prefetch') !== null || get('next-router-segment-prefetch') !== null) return true;
  return [get('purpose'), get('sec-purpose')].some((v) => typeof v === 'string' && /prefetch/i.test(v));
}

// 지금 처리 중인 요청의 클라이언트 IP와 프리페치 여부. next/headers가 없는 곳(proxy, 요청 밖)에서는 둘 다 없음.
async function requestContext(): Promise<{ ip: string | null; prefetch: boolean }> {
  try {
    const h = await headers();
    const get = (n: string) => h.get(n);
    return { ip: clientIpFrom(get), prefetch: isPrefetchRequest(get) };
  } catch {
    return { ip: null, prefetch: false };
  }
}

function parseError(body: unknown): ApiError | null {
  const e = (body as { error?: unknown } | null)?.error as Partial<ApiError> | undefined;
  if (!e || typeof e.code !== 'string' || typeof e.message !== 'string') return null;
  return {
    code: e.code,
    message: e.message,
    ...(e.sqlstate ? { sqlstate: e.sqlstate } : {}),
    ...(typeof e.field === 'string' ? { field: e.field } : {}),
    ...(typeof e.attemptsLeft === 'number' ? { attemptsLeft: e.attemptsLeft } : {}),
    ...(e.lockScope === 'account' || e.lockScope === 'daily' ? { lockScope: e.lockScope } : {}),
    ...(typeof e.retryAfterMinutes === 'number' ? { retryAfterMinutes: e.retryAfterMinutes } : {}),
    ...(typeof e.ticketVerified === 'boolean' ? { ticketVerified: e.ticketVerified } : {}),
    ...(typeof e.reason === 'string' ? { reason: e.reason } : {}),
  };
}

export async function apiFetch<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; session?: string | null; clientIp?: string | null; headers?: Record<string, string> },
): Promise<ApiResult<T>> {
  const base = process.env.BARA_API_URL;
  if (!base) throw new Error('BARA_API_URL is not set');

  const reqHeaders: Record<string, string> = { ...init.headers };
  if (init.session) reqHeaders['x-bara-session'] = init.session;
  // proxy passes the IP itself: next/headers isn't available there
  const ctx = init.clientIp !== undefined ? { ip: init.clientIp, prefetch: false } : await requestContext();
  if (ctx.ip) reqHeaders['x-bara-client-ip'] = ctx.ip;
  // 프리페치 렌더 중의 API 호출(관리자 레이아웃의 상태 조회 등)은 API가 "사용"으로 세지 않게 프리페치임을 알린다.
  // API는 프리페치 헤더가 있으면 x-bara-activity와 관리자 경로 규칙을 모두 무시한다(4.11 D-17).
  if (ctx.prefetch) {
    reqHeaders['next-router-prefetch'] = '1';
    delete reqHeaders['x-bara-activity'];
  }
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
