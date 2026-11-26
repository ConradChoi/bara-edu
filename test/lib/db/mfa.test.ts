import { beforeEach, expect, test, vi } from 'vitest';

// ---- 관리자 2단계 인증 API 래퍼(기획서 4장, 4.11). 모든 오류 코드 → 앱 reason 표, 요청 본문, 쿠키 처리 ----
const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => ({ get: () => null }) }));
vi.mock('@/lib/db/service-key', () => ({ getServiceKey: async () => 'secret-key' }));

import * as mfa from '@/lib/db/mfa';
import type { ApiResult } from '@/lib/db/api';

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const err = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => json(status, { error: { code, message, ...extra } });
const last = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: String(url), method: init.method, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(init.body) : undefined };
};
const cookies: Record<string, string> = {};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.BARA_API_URL = 'http://api.local';
  for (const k of Object.keys(cookies)) delete cookies[k];
  store.get.mockReset().mockImplementation((n: string) => (cookies[n] ? { value: cookies[n] } : undefined));
  store.set.mockReset();
  store.delete.mockReset();
});

const fail = (status: number, error: Record<string, unknown>): ApiResult<unknown> => ({ ok: false, status, error: { code: 'x', message: 'x', ...error } as never });

test('toMfaFailure: 4장 모든 오류 message → 앱 reason (+attemptsLeft·lockScope·retryAfterMinutes·ticketVerified)', () => {
  const cases: Array<[number, Record<string, unknown>, Record<string, unknown>]> = [
    // 401 (4.2·4.4)
    [401, { code: 'unauthenticated', message: 'challenge_invalid' }, { reason: 'challenge_invalid' }],
    [401, { code: 'unauthenticated', message: 'challenge_exhausted' }, { reason: 'challenge_exhausted' }],
    [401, { code: 'unauthenticated', message: 'account_changed' }, { reason: 'account_changed' }],
    [401, { code: 'unauthenticated', message: '로그인이 필요합니다.' }, { reason: 'unauthenticated' }], // D-10
    [401, { code: 'unauthenticated', message: 'session_expired', reason: 'idle' }, { reason: 'unauthenticated' }],
    [401, { code: 'unauthorized_service', message: 'x' }, { reason: 'failed' }], // 서비스 키 오류는 세션 문제가 아니다
    // 403
    [403, { code: 'forbidden', message: 'wrong_code', attemptsLeft: 3 }, { reason: 'wrong_code', attemptsLeft: 3 }],
    [403, { code: 'forbidden', message: 'wrong_code' }, { reason: 'wrong_code' }], // C 재확인은 attemptsLeft 없음(D-9)
    [403, { code: 'forbidden', message: 'code_reused', attemptsLeft: 4 }, { reason: 'code_reused', attemptsLeft: 4 }],
    [403, { code: 'forbidden', message: 'ticket_invalid', attemptsLeft: 2 }, { reason: 'ticket_invalid', attemptsLeft: 2 }],
    [403, { code: 'forbidden', message: 'ticket_not_verified' }, { reason: 'ticket_not_verified' }],
    [403, { code: 'forbidden', message: 'not_admin' }, { reason: 'not_admin' }],
    [403, { code: 'forbidden', message: 'mfa_session_required' }, { reason: 'mfa_session_required' }],
    [403, { code: 'forbidden', message: '관리자 권한이 필요합니다.' }, { reason: 'not_admin' }],
    // 404
    [404, { code: 'not_found', message: 'no_enrollment', ticketVerified: true }, { reason: 'no_enrollment', ticketVerified: true }],
    [404, { code: 'not_found', message: 'no_enrollment' }, { reason: 'no_enrollment' }],
    [404, { code: 'not_found', message: 'not_found' }, { reason: 'not_found' }],
    [404, { code: 'not_found', message: '요청한 경로를 찾을 수 없습니다.' }, { reason: 'unsupported' }], // 옛 API
    // 409
    ...(['ticket_unusable', 'enrollment_expired', 'already_enrolled', 'ticket_required', 'not_enrolled', 'self_reset', 'target_not_admin', 'target_withdrawn'] as const).map(
      (m) => [409, { code: 'conflict', message: m }, { reason: m }] as [number, Record<string, unknown>, Record<string, unknown>],
    ),
    [409, { code: 'conflict', message: 'something_else' }, { reason: 'failed' }],
    // 429
    [429, { code: 'rate_limited', message: 'mfa_locked', lockScope: 'account', retryAfterMinutes: 12 }, { reason: 'mfa_locked', lockScope: 'account', retryAfterMinutes: 12 }],
    [429, { code: 'rate_limited', message: 'mfa_locked', lockScope: 'daily', retryAfterMinutes: 1300 }, { reason: 'mfa_locked', lockScope: 'daily', retryAfterMinutes: 1300 }],
    [429, { code: 'rate_limited', message: 'mfa_locked' }, { reason: 'mfa_locked', lockScope: 'account', retryAfterMinutes: 15 }],
    [429, { code: 'rate_limited', message: 'rate_limited' }, { reason: 'rate_limited' }],
    // 400·503·그 밖
    [400, { code: 'validation', message: 'x', field: 'code' }, { reason: 'validation', field: 'code' }],
    [503, { code: 'unavailable', message: 'unavailable' }, { reason: 'unavailable' }],
    [503, { code: 'unavailable', message: 'log_failed' }, { reason: 'log_failed' }],
    [500, { code: 'internal', message: 'x' }, { reason: 'failed' }],
  ];
  for (const [status, e, want] of cases) {
    expect(mfa.toMfaFailure(fail(status, e)), `${status} ${String(e.message)}`).toEqual({ ok: false, ...want });
  }
});

test('verifyMfa: 대기표·번호는 본문으로만, 성공하면 bara_session을 쓰고 bara_mfa를 지운다', async () => {
  fetchMock.mockResolvedValue(json(200, { sessionToken: 'sess', expiresAt: '2026-11-27T02:00:00.000Z', userId: 'u1' }));
  expect(await mfa.verifyMfa('chal', '123456')).toEqual({ ok: true, userId: 'u1' });
  expect(last()).toMatchObject({ url: 'http://api.local/v1/auth/mfa/verify', method: 'POST', body: { challengeToken: 'chal', code: '123456' } });
  expect(last().headers['x-bara-session']).toBeUndefined();
  expect(last().url).not.toContain('chal');
  expect(store.set).toHaveBeenCalledWith('bara_session', 'sess', expect.objectContaining({ httpOnly: true, expires: new Date('2026-11-27T02:00:00.000Z') }));
  expect(store.delete).toHaveBeenCalledWith('bara_mfa');
});

test('verifyMfa 실패는 쿠키를 건드리지 않는다', async () => {
  fetchMock.mockResolvedValue(err(403, 'forbidden', 'wrong_code', { attemptsLeft: 2 }));
  expect(await mfa.verifyMfa('chal', '000000')).toEqual({ ok: false, reason: 'wrong_code', attemptsLeft: 2 });
  expect(store.set).not.toHaveBeenCalled();
  expect(store.delete).not.toHaveBeenCalled();
});

test('recoverMfa: 남은 복구 코드 수를 돌려주고 세션을 쓴다', async () => {
  fetchMock.mockResolvedValue(json(200, { sessionToken: 's', expiresAt: '2026-11-27T02:00:00.000Z', userId: 'u1', recoveryCodesLeft: 7 }));
  expect(await mfa.recoverMfa('chal', 'abcde-fghjk')).toEqual({ ok: true, userId: 'u1', recoveryCodesLeft: 7 });
  expect(last().body).toEqual({ challengeToken: 'chal', recoveryCode: 'abcde-fghjk' });
  expect(store.delete).toHaveBeenCalledWith('bara_mfa');
});

const ENROLL = { enrollmentId: '6f1c0b8e-0000-4000-8000-000000000001', otpauthUri: 'otpauth://totp/x?secret=ABCD', secretBase32: 'ABCDEFGH', expiresAt: '2026-11-26T08:00:00.000Z', entry: 'B' };

test('등록 B: ticket → start(renew) → current → confirm은 대기표로, 세션 헤더 없이', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
  expect(await mfa.checkEnrollTicket('chal', '12345678')).toEqual({ ok: true });
  expect(last().body).toEqual({ challengeToken: 'chal', enrollTicket: '12345678' });

  fetchMock.mockResolvedValueOnce(json(200, ENROLL));
  expect(await mfa.startMfaEnroll({ challenge: 'chal', renew: true })).toEqual({ ok: true, enrollment: ENROLL });
  expect(last()).toMatchObject({ url: 'http://api.local/v1/auth/mfa/enroll/start', body: { challengeToken: 'chal', renew: true } });

  fetchMock.mockResolvedValueOnce(err(404, 'not_found', 'no_enrollment', { ticketVerified: false }));
  expect(await mfa.getCurrentEnrollment('chal')).toEqual({ ok: false, reason: 'no_enrollment', ticketVerified: false });
  expect(last().body).toEqual({ challengeToken: 'chal' });

  fetchMock.mockResolvedValueOnce(json(200, { recoveryCodes: Array(10).fill('ABCDE-FGHJK'), sessionToken: 'new', expiresAt: '2026-11-27T02:00:00.000Z', userId: 'u1' }));
  const r = await mfa.confirmMfaEnroll({ enrollmentId: ENROLL.enrollmentId, code: '123456', challenge: 'chal' });
  expect(r).toMatchObject({ ok: true, userId: 'u1' });
  expect(last().body).toEqual({ enrollmentId: ENROLL.enrollmentId, code: '123456', challengeToken: 'chal' });
  for (const call of fetchMock.mock.calls) expect(call[1].headers['x-bara-session']).toBeUndefined();
  expect(store.set).toHaveBeenCalledWith('bara_session', 'new', expect.anything());
  expect(store.delete).toHaveBeenCalledWith('bara_mfa');
});

test('등록 A·C: 세션으로, C는 currentCode 또는 recoveryCode 하나와 rotateRecoveryCodes를 늘 명시한다(D-6)', async () => {
  cookies.bara_session = 'mine';
  fetchMock.mockResolvedValue(json(200, { ...ENROLL, entry: 'A' }));
  await mfa.startMfaEnroll({});
  expect(last()).toMatchObject({ body: {}, headers: { 'x-bara-session': 'mine' } });
  await mfa.startMfaEnroll({ renew: true });
  expect(last().body).toEqual({ renew: true });
  await mfa.startMfaEnroll({ currentCode: '123456' });
  expect(last().body).toEqual({ currentCode: '123456' });
  await mfa.startMfaEnroll({ recoveryCode: 'ABCDE-FGHJK' });
  expect(last().body).toEqual({ recoveryCode: 'ABCDE-FGHJK' });

  fetchMock.mockResolvedValue(json(200, { recoveryCodes: null }));
  expect(await mfa.confirmMfaEnroll({ enrollmentId: 'e', code: '111111', rotateRecoveryCodes: false })).toEqual({ ok: true, recoveryCodes: null, userId: null, sessionToken: null });
  expect(last().body).toEqual({ enrollmentId: 'e', code: '111111', rotateRecoveryCodes: false });
  expect(last().headers['x-bara-session']).toBe('mine');
  expect(store.set).not.toHaveBeenCalled(); // C는 세션을 새로 받지 않는다

  // A 확정: 기존 세션이 지워지고 새 세션 → 쿠키를 다시 쓴다(보안 점검 I-2)
  fetchMock.mockResolvedValue(json(200, { recoveryCodes: Array(10).fill('ABCDE-FGHJK'), sessionToken: 'fresh', expiresAt: '2026-11-27T02:00:00.000Z', userId: 'u1' }));
  await mfa.confirmMfaEnroll({ enrollmentId: 'e', code: '111111', rotateRecoveryCodes: true });
  expect(store.set).toHaveBeenCalledWith('bara_session', 'fresh', expect.anything());
});

test('start 응답이 계약 모양이 아니면(otpauth 아님 등) failed — 화면에 그리지 않는다', async () => {
  fetchMock.mockResolvedValue(json(200, { ...ENROLL, otpauthUri: 'https://evil.example/qr' }));
  expect(await mfa.startMfaEnroll({ challenge: 'c' })).toEqual({ ok: false, reason: 'failed' });
});

const STATUS = {
  mode: 'optional',
  enrolled: false,
  enrolledAt: null,
  lastUsedAt: null,
  recoveryCodesLeft: 0,
  recoveryCodesAcked: true,
  canSelfEnroll: true,
  graceUntil: '2026-12-03T00:00:00+09:00',
  signedInWithRecovery: false,
  sessionExpiresAt: '2026-11-27T02:00:00.000Z',
};

test('getMfaStatus: 세션 GET, 옛 API(경로 없음 404)는 unsupported, 세션 없으면 호출하지 않는다', async () => {
  expect(await mfa.getMfaStatus()).toEqual({ ok: false, reason: 'unauthenticated' });
  expect(fetchMock).not.toHaveBeenCalled();
  cookies.bara_session = 'mine';
  fetchMock.mockResolvedValueOnce(json(200, STATUS));
  expect(await mfa.getMfaStatus()).toEqual({ ok: true, status: STATUS });
  expect(last()).toMatchObject({ url: 'http://api.local/v1/auth/mfa/status', method: 'GET' });
  fetchMock.mockResolvedValueOnce(err(404, 'not_found', '요청한 경로를 찾을 수 없습니다.'));
  expect(await mfa.getMfaStatus()).toEqual({ ok: false, reason: 'unsupported' });
  fetchMock.mockResolvedValueOnce(err(403, 'forbidden', 'not_admin'));
  expect(await mfa.getMfaStatus()).toEqual({ ok: false, reason: 'not_admin' });
  fetchMock.mockResolvedValueOnce(json(200, { mode: 'weird' }));
  expect(await mfa.getMfaStatus()).toEqual({ ok: false, reason: 'failed' });
});

test('복구 코드 재발급·보관 확인', async () => {
  cookies.bara_session = 'mine';
  fetchMock.mockResolvedValueOnce(json(200, { recoveryCodes: Array(10).fill('ABCDE-FGHJK') }));
  expect(await mfa.regenerateRecoveryCodes('123456')).toMatchObject({ ok: true });
  expect(last()).toMatchObject({ url: 'http://api.local/v1/auth/mfa/recovery-codes', body: { code: '123456' } });
  fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
  expect(await mfa.ackRecoveryCodes()).toEqual({ ok: true });
  expect(last()).toMatchObject({ url: 'http://api.local/v1/auth/mfa/recovery-codes/ack', body: {} });
});

test('관리자 초기화: identityChecked true, memo는 있을 때만, 등록 코드 8자리 확인', async () => {
  cookies.bara_session = 'mine';
  fetchMock.mockResolvedValueOnce(json(200, { ok: true, enrollTicket: '12345678', ticketExpiresAt: '2026-11-27T05:00:00.000Z' }));
  expect(await mfa.adminResetMfa('u/2', { code: '123456', reason: 'lost_phone', memo: null, identityChecked: true })).toEqual({
    ok: true,
    enrollTicket: '12345678',
    ticketExpiresAt: '2026-11-27T05:00:00.000Z',
  });
  expect(last()).toMatchObject({ url: 'http://api.local/v1/admin/users/u%2F2/mfa-reset', body: { code: '123456', reason: 'lost_phone', identityChecked: true } });
  expect(last().body).not.toHaveProperty('memo');
  fetchMock.mockResolvedValueOnce(json(200, { ok: true, enrollTicket: 'nope' }));
  expect(await mfa.adminResetMfa('u2', { code: '123456', reason: 'other', memo: '메모 다섯자', identityChecked: true })).toEqual({ ok: false, reason: 'failed' });
  expect(last().body.memo).toBe('메모 다섯자');
});

test('관리자 조회: 상세 상태, 목록 overview(실패·옛 API면 null)', async () => {
  cookies.bara_session = 'mine';
  fetchMock.mockResolvedValueOnce(json(200, { state: 'reset_pending', enrolledAt: null, lastUsedAt: null, ticketPendingUntil: '2026-11-27T05:00:00.000Z' }));
  expect(await mfa.adminGetMfa('u2')).toEqual({ ok: true, info: { state: 'reset_pending', enrolledAt: null, lastUsedAt: null, ticketPendingUntil: '2026-11-27T05:00:00.000Z' } });
  fetchMock.mockResolvedValueOnce(err(404, 'not_found', '요청한 경로를 찾을 수 없습니다.'));
  expect(await mfa.adminGetMfa('u2')).toEqual({ ok: false, reason: 'unsupported' });
  fetchMock.mockResolvedValueOnce(json(200, { items: [{ userId: 'a', state: 'enrolled' }, { userId: 'b', state: 'bogus' }] }));
  expect(await mfa.adminMfaOverview()).toEqual(new Map([['a', 'enrolled']]));
  fetchMock.mockResolvedValueOnce(err(404, 'not_found', '요청한 경로를 찾을 수 없습니다.'));
  expect(await mfa.adminMfaOverview()).toBeNull();
});
