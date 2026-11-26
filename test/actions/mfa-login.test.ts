import { beforeEach, expect, test, vi } from 'vitest';

// ---- 관리자 로그인 2단계·로그인 중 등록 서버 액션(기획서 3.2~3.4, 4.1~4.4, 디자인 스펙 T-3~T-5) ----
// 대기표는 httpOnly 쿠키(bara_mfa)에서만 읽고 상태·URL·hidden에 싣지 않는다. 오류는 4장 message마다 화면 상태 하나로 바뀐다.
const jar = new Map<string, string>();
const store = {
  get: vi.fn((n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined)),
  set: vi.fn((n: string, v: string) => void jar.set(n, v)),
  delete: vi.fn((n: string) => void jar.delete(n)),
};
vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => ({ get: () => null }) }));
vi.mock('@/lib/db/service-key', () => ({ getServiceKey: async () => 'secret-key' }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('server-only', () => ({}));

import * as actions from '@/app/actions/auth';
import type { SetupView } from '@/lib/mfa-setup-types';

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const err = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => json(status, { error: { code, message, ...extra } });
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const pathOf = (call: unknown[]) => new URL(String(call[0])).pathname;
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body ?? '{}'));
const calls = (path: string) => fetchMock.mock.calls.filter((c) => pathOf(c) === path);
const settle = <T,>(p: Promise<T>) => p.then((v) => v as T | string, (e: Error) => e.message);

const ENROLLMENT = {
  enrollmentId: 'enr-1',
  otpauthUri: 'otpauth://totp/%EB%B0%94%EB%9D%BC:a%40b.kr?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=x&digits=6&period=30&algorithm=SHA1',
  secretBase32: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  expiresAt: '2026-11-26T05:20:00.000Z',
  entry: 'B',
};
const SESSION = { sessionToken: 'new-session', expiresAt: '2026-11-26T17:00:00.000Z', userId: 'u1' };
const CODES = Array.from({ length: 10 }, (_, i) => `ABCD${i}-EFGH${i}`);

// 경로별 응답 표. 값이 함수면 요청마다 부른다.
let routes: Record<string, Response | (() => Response)> = {};
beforeEach(() => {
  jar.clear();
  routes = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const r = routes[new URL(url).pathname];
    if (!r) return err(404, 'not_found', '요청한 경로를 찾을 수 없습니다.');
    return typeof r === 'function' ? r() : r.clone();
  });
  vi.stubGlobal('fetch', fetchMock);
  process.env.BARA_API_URL = 'http://api.local';
  store.set.mockClear();
  store.delete.mockClear();
});

// ---- login 분기 ----

test('login: 응답에 mfa가 없으면(지금의 운영 API) 지금과 똑같이 세션 쿠키 + redirect — 2단계 화면으로 가지 않는다', async () => {
  routes['/v1/auth/login'] = json(200, { sessionToken: 'tok', expiresAt: '2026-12-21T00:00:00.000Z', userId: 'u1' });
  expect(await settle(actions.login(undefined, form({ email: 'a@b.kr', password: 'pw', redirect: '/admin/members' })))).toBe('REDIRECT:/admin/members');
  expect(jar.get('bara_session')).toBe('tok');
  expect(jar.has('bara_mfa')).toBe(false);
});

test('login: mfa=required → bara_mfa 쿠키 + /sign-in/otp?redirect=(안전한 경로만), 세션 없음', async () => {
  routes['/v1/auth/login'] = json(200, { mfa: 'required', challengeToken: 'chal', challengeExpiresAt: new Date(Date.now() + 300_000).toISOString() });
  expect(await settle(actions.login(undefined, form({ email: 'a@b.kr', password: 'pw', redirect: '/admin/members?q=1' })))).toBe('REDIRECT:/sign-in/otp?redirect=%2Fadmin%2Fmembers%3Fq%3D1');
  expect(jar.get('bara_mfa')).toBe('chal');
  expect(jar.has('bara_session')).toBe(false);
  for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '/\t/evil.com']) {
    expect(await settle(actions.login(undefined, form({ email: 'a@b.kr', password: 'pw', redirect: bad })))).toBe('REDIRECT:/sign-in/otp');
  }
  expect(await settle(actions.login(undefined, form({ email: 'a@b.kr', password: 'pw' })))).toBe('REDIRECT:/sign-in/otp');
});

test('login: enroll_required → /sign-in/otp-setup, 초기화된 계정이면 &reason=reset', async () => {
  routes['/v1/auth/login'] = json(200, { mfa: 'enroll_required', enrollReason: 'reset', challengeToken: 'chal', challengeExpiresAt: '2026-11-26T05:15:00.000Z' });
  expect(await settle(actions.login(undefined, form({ email: 'a@b.kr', password: 'pw', redirect: '/admin' })))).toBe('REDIRECT:/sign-in/otp-setup?redirect=%2Fadmin&reason=reset');
  routes['/v1/auth/login'] = json(200, { mfa: 'enroll_required', enrollReason: 'first', challengeToken: 'chal', challengeExpiresAt: '2026-11-26T05:15:00.000Z' });
  expect(await settle(actions.login(undefined, form({ email: 'a@b.kr', password: 'pw' })))).toBe('REDIRECT:/sign-in/otp-setup');
});

// ---- M1 verifyOtp ----

test('verifyOtp: 형식(숫자 6자리, 공백·하이픈 허용)이 틀리면 API 없이 format, 대기표 쿠키가 없으면 만료 화면', async () => {
  jar.set('bara_mfa', 'chal');
  for (const bad of ['', '12345', '1234567', '12a456']) expect(await actions.verifyOtp(undefined, form({ code: bad }))).toEqual({ kind: 'field', error: 'format' });
  expect(fetchMock).not.toHaveBeenCalled();
  jar.clear();
  expect(await actions.verifyOtp(undefined, form({ code: '123456' }))).toEqual({ kind: 'screen', screen: 'expired' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('verifyOtp: 4.2 오류 → 화면 상태(칸·알림·상태 화면), 상태 화면이면 대기표 쿠키를 지운다', async () => {
  const cases: Array<[Response, unknown, boolean]> = [
    [err(403, 'forbidden', 'wrong_code', { attemptsLeft: 3 }), { kind: 'field', error: 'wrong', attemptsLeft: 3 }, false],
    [err(403, 'forbidden', 'code_reused', { attemptsLeft: 4 }), { kind: 'field', error: 'used' }, false],
    [err(400, 'validation', 'code', { field: 'code' }), { kind: 'field', error: 'format' }, false],
    [err(401, 'unauthenticated', 'challenge_invalid'), { kind: 'screen', screen: 'expired' }, true],
    [err(401, 'unauthenticated', 'challenge_exhausted'), { kind: 'screen', screen: 'exhausted' }, true],
    [err(401, 'unauthenticated', 'account_changed'), { kind: 'screen', screen: 'demoted' }, true],
    [err(429, 'rate_limited', 'mfa_locked', { lockScope: 'account', retryAfterMinutes: 11.2 }), { kind: 'screen', screen: 'locked', lockScope: 'account', minutes: 12 }, true],
    [err(429, 'rate_limited', 'mfa_locked', { lockScope: 'daily', retryAfterMinutes: 1440 }), { kind: 'screen', screen: 'locked', lockScope: 'daily', minutes: 1440 }, true],
    [err(429, 'rate_limited', '요청이 많아요'), { kind: 'notice', notice: 'rate_limited' }, false],
    [err(503, 'unavailable', 'unavailable'), { kind: 'notice', notice: 'unavailable' }, false],
    [err(500, 'internal', 'x'), { kind: 'notice', notice: 'failed' }, false],
    [err(401, 'unauthorized_service', 'x'), { kind: 'notice', notice: 'failed' }, false],
  ];
  for (const [res, want, cleared] of cases) {
    jar.set('bara_mfa', 'chal');
    routes['/v1/auth/mfa/verify'] = res;
    expect(await actions.verifyOtp(undefined, form({ code: '123 456' })), JSON.stringify(want)).toEqual(want);
    expect(jar.has('bara_mfa'), JSON.stringify(want)).toBe(!cleared);
  }
  // 대기표는 본문으로만, 번호는 정리된 6자리
  expect(bodyOf(calls('/v1/auth/mfa/verify')[0])).toEqual({ challengeToken: 'chal', code: '123456' });
});

test('verifyOtp 성공: bara_mfa 삭제 + bara_session 쓰기 + redirect 값(안전할 때만) 또는 /admin', async () => {
  routes['/v1/auth/mfa/verify'] = json(200, SESSION);
  jar.set('bara_mfa', 'chal');
  expect(await settle(actions.verifyOtp(undefined, form({ code: '123456', redirect: '/admin/members' })))).toBe('REDIRECT:/admin/members');
  expect(jar.get('bara_session')).toBe('new-session');
  expect(jar.has('bara_mfa')).toBe(false);
  for (const [r, want] of [['//evil.com', '/admin'], ['', '/admin'], ['https://evil.com/admin', '/admin']]) {
    jar.set('bara_mfa', 'chal');
    expect(await settle(actions.verifyOtp(undefined, form({ code: '123456', redirect: r })))).toBe(`REDIRECT:${want}`);
  }
});

// ---- M2 verifyRecoveryCode ----

test('verifyRecoveryCode: 빈 값은 format, 틀림은 남은 횟수와 함께, 재사용 구분 없이 틀림, 성공은 /admin', async () => {
  jar.set('bara_mfa', 'chal');
  expect(await actions.verifyRecoveryCode(undefined, form({ recoveryCode: '  ' }))).toEqual({ kind: 'field', error: 'format' });
  routes['/v1/auth/mfa/recover'] = err(403, 'forbidden', 'wrong_code', { attemptsLeft: 2 });
  expect(await actions.verifyRecoveryCode(undefined, form({ recoveryCode: 'abcde fghjk' }))).toEqual({ kind: 'field', error: 'wrong', attemptsLeft: 2 });
  expect(bodyOf(calls('/v1/auth/mfa/recover')[0])).toEqual({ challengeToken: 'chal', recoveryCode: 'abcde fghjk' });
  routes['/v1/auth/mfa/recover'] = err(403, 'forbidden', 'code_reused');
  expect(await actions.verifyRecoveryCode(undefined, form({ recoveryCode: 'ABCDE-FGHJK' }))).toEqual({ kind: 'field', error: 'wrong' });
  routes['/v1/auth/mfa/recover'] = err(401, 'unauthenticated', 'challenge_exhausted');
  expect(await actions.verifyRecoveryCode(undefined, form({ recoveryCode: 'ABCDE-FGHJK' }))).toEqual({ kind: 'screen', screen: 'exhausted' });
  jar.set('bara_mfa', 'chal');
  routes['/v1/auth/mfa/recover'] = json(200, { ...SESSION, recoveryCodesLeft: 4 });
  expect(await settle(actions.verifyRecoveryCode(undefined, form({ recoveryCode: 'ABCDE-FGHJK' })))).toBe('REDIRECT:/admin');
  expect(jar.get('bara_session')).toBe('new-session');
  expect(jar.has('bara_mfa')).toBe(false);
});

test('restartLogin: 대기표 쿠키를 지우고 /sign-in', async () => {
  jar.set('bara_mfa', 'chal');
  expect(await settle(actions.restartLogin())).toBe('REDIRECT:/sign-in');
  expect(jar.has('bara_mfa')).toBe(false);
});

// ---- M3 otpSetupStep(입구 B) ----

const step = (fields: Record<string, string>) => actions.otpSetupStep({ step: 'prep', entry: 'B' }, form(fields)) as Promise<SetupView>;

test('등록(B): 대기표가 없으면 만료 화면, [이전]은 앱 준비', async () => {
  expect(await step({ intent: 'next' })).toEqual({ step: 'end', screen: 'expired' });
  expect(await step({ intent: 'back' })).toEqual({ step: 'prep', entry: 'B' });
});

test('등록(B) [앱을 설치했어요]: 등록 대기가 있으면 같은 QR, 없으면 등록 코드 확인 여부로 등록 코드 단계 또는 바로 start', async () => {
  jar.set('bara_mfa', 'chal');
  routes['/v1/auth/mfa/enroll/current'] = json(200, ENROLLMENT);
  const qr = await step({ intent: 'next' });
  expect(qr).toMatchObject({ step: 'qr', entry: 'B', rotateDefault: false, qr: { enrollmentId: 'enr-1', otpauthUri: ENROLLMENT.otpauthUri } });
  if (qr.step !== 'qr') throw new Error('qr');
  expect(qr.qr.keyGroups).toEqual(['JBSW', 'Y3DP', 'EHPK', '3PXP', 'JBSW', 'Y3DP', 'EHPK', '3PXP']);
  expect(qr.qr.path).toMatch(/^M0 0h7v1h-7z/);
  expect(bodyOf(calls('/v1/auth/mfa/enroll/current')[0])).toEqual({ challengeToken: 'chal' });

  routes['/v1/auth/mfa/enroll/current'] = err(404, 'not_found', 'no_enrollment', { ticketVerified: false });
  expect(await step({ intent: 'next' })).toEqual({ step: 'ticket' });

  routes['/v1/auth/mfa/enroll/current'] = err(404, 'not_found', 'no_enrollment', { ticketVerified: true });
  routes['/v1/auth/mfa/enroll/start'] = json(200, ENROLLMENT);
  expect(await step({ intent: 'next' })).toMatchObject({ step: 'qr' });
  expect(bodyOf(calls('/v1/auth/mfa/enroll/start')[0])).toEqual({ challengeToken: 'chal' });

  routes['/v1/auth/mfa/enroll/current'] = err(401, 'unauthenticated', 'account_changed');
  expect(await step({ intent: 'next' })).toEqual({ step: 'end', screen: 'demoted' });
  expect(jar.has('bara_mfa')).toBe(false);
});

test('등록(B) 등록 코드: 형식(숫자 8자리) → API 없음, ticket_invalid → 남은 횟수, ticket_unusable(5번째 실패 포함) → 사용 불가 화면 + 쿠키 삭제', async () => {
  jar.set('bara_mfa', 'chal');
  expect(await step({ intent: 'ticket', ticket: '1234567' })).toEqual({ step: 'ticket', error: 'format' });
  expect(fetchMock).not.toHaveBeenCalled();
  routes['/v1/auth/mfa/enroll/ticket'] = err(403, 'forbidden', 'ticket_invalid', { attemptsLeft: 2 });
  expect(await step({ intent: 'ticket', ticket: '1234 5678' })).toEqual({ step: 'ticket', error: 'wrong', attemptsLeft: 2 });
  expect(bodyOf(calls('/v1/auth/mfa/enroll/ticket')[0])).toEqual({ challengeToken: 'chal', enrollTicket: '12345678' });
  routes['/v1/auth/mfa/enroll/ticket'] = err(429, 'rate_limited', '요청이 많아요');
  expect(await step({ intent: 'ticket', ticket: '12345678' })).toEqual({ step: 'ticket', notice: { kind: 'rate_limited' } });
  routes['/v1/auth/mfa/enroll/ticket'] = err(409, 'conflict', 'ticket_unusable');
  expect(await step({ intent: 'ticket', ticket: '12345678' })).toEqual({ step: 'end', screen: 'ticket_dead' });
  expect(jar.has('bara_mfa')).toBe(false);
});

test('등록(B) 등록 코드 통과 → start → QR. start가 409 ticket_unusable(D-7)이면 사용 불가 화면', async () => {
  jar.set('bara_mfa', 'chal');
  routes['/v1/auth/mfa/enroll/ticket'] = json(200, { ok: true });
  routes['/v1/auth/mfa/enroll/start'] = json(200, ENROLLMENT);
  expect(await step({ intent: 'ticket', ticket: '12345678' })).toMatchObject({ step: 'qr', entry: 'B' });
  routes['/v1/auth/mfa/enroll/start'] = err(409, 'conflict', 'ticket_unusable');
  expect(await step({ intent: 'ticket', ticket: '12345678' })).toEqual({ step: 'end', screen: 'ticket_dead' });
});

test('등록(B) [QR 새로 만들기]: renew=true, 실패는 만료 화면 위 알림', async () => {
  jar.set('bara_mfa', 'chal');
  routes['/v1/auth/mfa/enroll/start'] = json(200, ENROLLMENT);
  expect(await step({ intent: 'renew' })).toMatchObject({ step: 'qr' });
  expect(bodyOf(calls('/v1/auth/mfa/enroll/start')[0])).toEqual({ challengeToken: 'chal', renew: true });
  routes['/v1/auth/mfa/enroll/start'] = err(503, 'unavailable', 'unavailable');
  expect(await step({ intent: 'renew' })).toEqual({ step: 'qr_expired', entry: 'B', notice: { kind: 'unavailable' } });
});

test('등록(B) 확인 번호: 틀림·재사용·형식은 같은 QR을 다시 그리고 오류, 5회·10분은 [QR 새로 만들기], 대기표 만료는 만료 화면', async () => {
  jar.set('bara_mfa', 'chal');
  routes['/v1/auth/mfa/enroll/current'] = json(200, ENROLLMENT);
  const confirm = (code = '123456') => step({ intent: 'confirm', enrollmentId: 'enr-1', code });
  expect(await confirm('12')).toMatchObject({ step: 'qr', error: 'format' });
  expect(calls('/v1/auth/mfa/enroll/confirm')).toHaveLength(0);
  routes['/v1/auth/mfa/enroll/confirm'] = err(403, 'forbidden', 'wrong_code', { attemptsLeft: 1 });
  expect(await confirm()).toMatchObject({ step: 'qr', error: 'wrong', attemptsLeft: 1, qr: { enrollmentId: 'enr-1' } });
  routes['/v1/auth/mfa/enroll/confirm'] = err(403, 'forbidden', 'code_reused');
  expect(await confirm()).toMatchObject({ step: 'qr', error: 'used' });
  routes['/v1/auth/mfa/enroll/confirm'] = err(409, 'conflict', 'enrollment_expired');
  expect(await confirm()).toEqual({ step: 'qr_expired', entry: 'B' });
  routes['/v1/auth/mfa/enroll/confirm'] = err(404, 'not_found', 'not_found');
  expect(await confirm()).toEqual({ step: 'qr_expired', entry: 'B' });
  routes['/v1/auth/mfa/enroll/confirm'] = err(503, 'unavailable', 'log_failed');
  expect(await confirm()).toMatchObject({ step: 'qr', notice: { kind: 'unavailable' } });
  routes['/v1/auth/mfa/enroll/confirm'] = err(409, 'conflict', 'ticket_unusable');
  expect(await confirm()).toEqual({ step: 'end', screen: 'ticket_dead' });
  jar.set('bara_mfa', 'chal');
  routes['/v1/auth/mfa/enroll/confirm'] = err(401, 'unauthenticated', 'challenge_invalid');
  expect(await confirm()).toEqual({ step: 'end', screen: 'expired' });
});

test('등록(B) 확정: 세션 쿠키 쓰기·대기표 삭제, 복구 코드 10개 + 인쇄용 이름(새 세션으로 조회), 이메일은 상태에 없다', async () => {
  jar.set('bara_mfa', 'chal');
  routes['/v1/auth/mfa/enroll/confirm'] = json(200, { recoveryCodes: CODES, ...SESSION });
  routes['/v1/query'] = json(200, { data: { name: '김관리' } });
  const v = await step({ intent: 'confirm', enrollmentId: 'enr-1', code: '123456', reason: 'reset' });
  expect(v).toMatchObject({ step: 'codes', codes: CODES, name: '김관리', reason: 'reenroll' });
  expect(jar.get('bara_session')).toBe('new-session');
  expect(jar.has('bara_mfa')).toBe(false);
  expect(bodyOf(calls('/v1/auth/mfa/enroll/confirm')[0])).toEqual({ enrollmentId: 'enr-1', code: '123456', challengeToken: 'chal' });
  // 이름 조회는 방금 받은 세션으로
  const q = calls('/v1/query')[0];
  expect((q[1] as RequestInit & { headers: Record<string, string> }).headers['x-bara-session']).toBe('new-session');
  expect(JSON.stringify(v)).not.toContain('a@b.kr');
});

test('등록(B) 복구 코드 [관리자 화면으로]: 보관 확인(ack) 실패해도 이동, redirect 값 또는 /admin', async () => {
  jar.set('bara_session', 'new-session');
  routes['/v1/auth/mfa/recovery-codes/ack'] = err(503, 'unavailable', 'unavailable');
  expect(await settle(step({ intent: 'ack', redirect: '/admin/members' }))).toBe('REDIRECT:/admin/members');
  routes['/v1/auth/mfa/recovery-codes/ack'] = json(200, { ok: true });
  expect(await settle(step({ intent: 'ack' }))).toBe('REDIRECT:/admin');
  expect(calls('/v1/auth/mfa/recovery-codes/ack')).toHaveLength(2);
});
