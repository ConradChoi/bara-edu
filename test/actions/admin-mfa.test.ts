import { beforeEach, expect, test, vi } from 'vitest';

// ---- 내 보안 설정(M4, 입구 A·C·복구 코드 새로 받기)과 다른 관리자 초기화(M5) 서버 액션 ----
// 기획서 3.5·3.6, 4.4·4.5·4.6, 4.11 D-5·D-6·D-9·D-10, 디자인 스펙 T-7·T-9.
const jar = new Map<string, string>([['bara_session', 'admin-tok']]);
const store = {
  get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
  set: vi.fn((n: string, v: string) => void jar.set(n, v)),
  delete: vi.fn((n: string) => void jar.delete(n)),
};
vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => ({ get: () => null }) }));
vi.mock('@/lib/db/service-key', () => ({ getServiceKey: async () => 'svc-key' }));
vi.mock('server-only', () => ({}));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/supabase/require-admin', () => ({ requireAdminClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin-queries', () => ({ logAdminAccess: vi.fn() }));

import { resetAdminMfa } from '@/app/actions/admin-members';
import { securityStep } from '@/app/actions/admin-security';
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
let routes: Record<string, Response> = {};

const ENROLLMENT = {
  enrollmentId: 'enr-9',
  otpauthUri: 'otpauth://totp/x:a%40b.kr?secret=JBSWY3DPEHPK3PXP&issuer=x&digits=6&period=30&algorithm=SHA1',
  secretBase32: 'JBSWY3DPEHPK3PXP',
  expiresAt: '2026-11-26T05:20:00.000Z',
  entry: 'A',
};
const CODES = Array.from({ length: 10 }, (_, i) => `ABCD${i}-EFGH${i}`);

beforeEach(() => {
  jar.clear();
  jar.set('bara_session', 'admin-tok');
  routes = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => routes[new URL(url).pathname]?.clone() ?? err(404, 'not_found', '요청한 경로를 찾을 수 없습니다.'));
  vi.stubGlobal('fetch', fetchMock);
  process.env.BARA_API_URL = 'http://api.local';
  revalidatePath.mockClear();
});

const step = (fields: Record<string, string>) => securityStep({ step: 'status' }, form(fields)) as Promise<SetupView>;

test('M4 버튼: [지금 등록하기] → 앱 준비(A), [인증 앱 바꾸기] → 재확인(6자리/복구 코드), [복구 코드 새로 받기] → 재확인(6자리), [이전] → 상태 카드', async () => {
  expect(await step({ intent: 'enroll' })).toEqual({ step: 'prep', entry: 'A' });
  expect(await step({ intent: 'change' })).toEqual({ step: 'recheck', purpose: 'change', mode: 'otp' });
  expect(await step({ intent: 'change', mode: 'rc' })).toEqual({ step: 'recheck', purpose: 'change', mode: 'rc' });
  expect(await step({ intent: 'regen' })).toEqual({ step: 'recheck', purpose: 'regen', mode: 'otp' });
  expect(await step({ intent: 'back' })).toEqual({ step: 'status' });
  expect(await step({ intent: 'back', to: 'prep', entry: 'C', checkedWith: 'rc' })).toEqual({ step: 'prep', entry: 'C', checkedWith: 'rc' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('입구 A: start({}) → QR(세션으로), already_enrolled → 상태 카드 알림, 세션 없음(401 로그인이 필요합니다.) → 다시 로그인 알림', async () => {
  routes['/v1/auth/mfa/enroll/start'] = json(200, ENROLLMENT);
  expect(await step({ intent: 'next', entry: 'A' })).toMatchObject({ step: 'qr', entry: 'A', qr: { enrollmentId: 'enr-9' } });
  const call = calls('/v1/auth/mfa/enroll/start')[0];
  expect(bodyOf(call)).toEqual({});
  expect((call[1] as { headers: Record<string, string> }).headers['x-bara-session']).toBe('admin-tok');
  routes['/v1/auth/mfa/enroll/start'] = err(409, 'conflict', 'already_enrolled');
  expect(await step({ intent: 'next', entry: 'A' })).toEqual({ step: 'status', notice: { kind: 'already' } });
  routes['/v1/auth/mfa/enroll/start'] = err(401, 'unauthenticated', '로그인이 필요합니다.');
  expect(await step({ intent: 'next', entry: 'A' })).toEqual({ step: 'status', notice: { kind: 'session_expired' } });
  routes['/v1/auth/mfa/enroll/start'] = err(503, 'unavailable', 'unavailable');
  expect(await step({ intent: 'next', entry: 'A' })).toEqual({ step: 'prep', entry: 'A', notice: { kind: 'unavailable' } });
});

test('입구 A 확정: 기존 세션 대신 새 세션 쿠키(I-2) + 복구 코드 단계, 이름은 새 세션으로 조회', async () => {
  routes['/v1/auth/mfa/enroll/confirm'] = json(200, { recoveryCodes: CODES, sessionToken: 'fresh', expiresAt: '2026-11-26T17:00:00.000Z', userId: 'u1' });
  routes['/v1/query'] = json(200, { data: { name: '김관리' } });
  const v = await step({ intent: 'confirm', entry: 'A', enrollmentId: 'enr-9', code: '123456' });
  expect(v).toMatchObject({ step: 'codes', codes: CODES, name: '김관리', reason: 'enroll' });
  expect(jar.get('bara_session')).toBe('fresh');
  expect(bodyOf(calls('/v1/auth/mfa/enroll/confirm')[0])).toEqual({ enrollmentId: 'enr-9', code: '123456', rotateRecoveryCodes: true });
});

test('입구 C 재확인: 6자리(currentCode) 또는 복구 코드(recoveryCode) 중 하나만 보낸다, 틀림은 남은 횟수 없이(D-9), 재사용·잠김', async () => {
  routes['/v1/auth/mfa/enroll/start'] = json(200, { ...ENROLLMENT, entry: 'C' });
  expect(await step({ intent: 'recheck', purpose: 'change', mode: 'otp', code: '111 222' })).toEqual({ step: 'prep', entry: 'C', checkedWith: 'otp' });
  expect(bodyOf(calls('/v1/auth/mfa/enroll/start')[0])).toEqual({ currentCode: '111222' });
  expect(await step({ intent: 'recheck', purpose: 'change', mode: 'rc', recoveryCode: 'abcde-fghjk' })).toEqual({ step: 'prep', entry: 'C', checkedWith: 'rc' });
  expect(bodyOf(calls('/v1/auth/mfa/enroll/start')[1])).toEqual({ recoveryCode: 'abcde-fghjk' });

  expect(await step({ intent: 'recheck', purpose: 'change', mode: 'otp', code: '12' })).toEqual({ step: 'recheck', purpose: 'change', mode: 'otp', error: 'format' });
  routes['/v1/auth/mfa/enroll/start'] = err(403, 'forbidden', 'wrong_code');
  expect(await step({ intent: 'recheck', purpose: 'change', mode: 'otp', code: '123456' })).toEqual({ step: 'recheck', purpose: 'change', mode: 'otp', error: 'wrong' });
  expect(await step({ intent: 'recheck', purpose: 'change', mode: 'rc', recoveryCode: 'X' })).toEqual({ step: 'recheck', purpose: 'change', mode: 'rc', error: 'wrong' });
  routes['/v1/auth/mfa/enroll/start'] = err(403, 'forbidden', 'code_reused');
  expect(await step({ intent: 'recheck', purpose: 'change', mode: 'otp', code: '123456' })).toEqual({ step: 'recheck', purpose: 'change', mode: 'otp', error: 'used' });
  routes['/v1/auth/mfa/enroll/start'] = err(429, 'rate_limited', 'mfa_locked', { lockScope: 'daily', retryAfterMinutes: 1440 });
  expect(await step({ intent: 'recheck', purpose: 'change', mode: 'otp', code: '123456' })).toEqual({
    step: 'recheck',
    purpose: 'change',
    mode: 'otp',
    notice: { kind: 'locked', lockScope: 'daily', minutes: 1440 },
  });
  routes['/v1/auth/mfa/enroll/start'] = err(409, 'conflict', 'not_enrolled');
  expect(await step({ intent: 'recheck', purpose: 'change', mode: 'otp', code: '123456' })).toEqual({ step: 'status', notice: { kind: 'failed' } });
});

test('입구 C: 앱 준비 다음은 같은 등록 대기(enroll/current), 복구 코드로 확인했으면 새로 받기 기본 체크, [QR 새로 만들기]는 재확인부터(D-5)', async () => {
  routes['/v1/auth/mfa/enroll/current'] = json(200, { ...ENROLLMENT, entry: 'C' });
  expect(await step({ intent: 'next', entry: 'C', checkedWith: 'rc' })).toMatchObject({ step: 'qr', entry: 'C', rotateDefault: true });
  expect(await step({ intent: 'next', entry: 'C', checkedWith: 'otp' })).toMatchObject({ step: 'qr', entry: 'C', rotateDefault: false });
  expect(bodyOf(calls('/v1/auth/mfa/enroll/current')[0])).toEqual({});
  routes['/v1/auth/mfa/enroll/current'] = err(404, 'not_found', 'no_enrollment');
  expect(await step({ intent: 'next', entry: 'C', checkedWith: 'otp' })).toEqual({ step: 'recheck', purpose: 'change', mode: 'otp' });
  expect(await step({ intent: 'renew', entry: 'C' })).toEqual({ step: 'recheck', purpose: 'change', mode: 'otp' });
  expect(calls('/v1/auth/mfa/enroll/start')).toHaveLength(0);
});

test('입구 C 확정: rotateRecoveryCodes를 늘 명시(D-6), 새로 받지 않으면 완료 화면, 받으면 복구 코드', async () => {
  routes['/v1/auth/mfa/enroll/confirm'] = json(200, { recoveryCodes: null });
  expect(await step({ intent: 'confirm', entry: 'C', enrollmentId: 'enr-9', code: '123456' })).toEqual({ step: 'changed' });
  expect(bodyOf(calls('/v1/auth/mfa/enroll/confirm')[0])).toEqual({ enrollmentId: 'enr-9', code: '123456', rotateRecoveryCodes: false });
  routes['/v1/auth/mfa/enroll/confirm'] = json(200, { recoveryCodes: CODES });
  routes['/v1/auth/session'] = json(200, { user: { id: 'u1' } });
  routes['/v1/query'] = json(200, { data: { name: '김관리' } });
  expect(await step({ intent: 'confirm', entry: 'C', enrollmentId: 'enr-9', code: '123456', rotate: 'on' })).toMatchObject({ step: 'codes', reason: 'change', name: '김관리' });
  expect(bodyOf(calls('/v1/auth/mfa/enroll/confirm')[1])).toEqual({ enrollmentId: 'enr-9', code: '123456', rotateRecoveryCodes: true });
  // 세션은 그대로(C는 지금 세션을 남기고 다른 세션만 지운다)
  expect(jar.get('bara_session')).toBe('admin-tok');
});

test('확정 실패: 틀림은 같은 QR + 남은 횟수(고른 새로 받기 값 유지), 5회·10분 → [QR 새로 만들기], 세션 끝 → 상태 카드 알림', async () => {
  routes['/v1/auth/mfa/enroll/current'] = json(200, { ...ENROLLMENT, entry: 'C' });
  routes['/v1/auth/mfa/enroll/confirm'] = err(403, 'forbidden', 'wrong_code', { attemptsLeft: 2 });
  expect(await step({ intent: 'confirm', entry: 'C', enrollmentId: 'enr-9', code: '123456', rotate: 'on' })).toMatchObject({ step: 'qr', entry: 'C', rotateDefault: true, error: 'wrong', attemptsLeft: 2 });
  routes['/v1/auth/mfa/enroll/confirm'] = err(409, 'conflict', 'enrollment_expired');
  expect(await step({ intent: 'confirm', entry: 'A', enrollmentId: 'enr-9', code: '123456' })).toEqual({ step: 'qr_expired', entry: 'A' });
  routes['/v1/auth/mfa/enroll/confirm'] = err(401, 'unauthenticated', '로그인이 필요합니다.');
  expect(await step({ intent: 'confirm', entry: 'A', enrollmentId: 'enr-9', code: '123456' })).toEqual({ step: 'status', notice: { kind: 'session_expired' } });
});

test('복구 코드 새로 받기: 6자리 재확인 → 새 10개, 틀림·잠김(15분 {m})', async () => {
  routes['/v1/auth/mfa/recovery-codes'] = json(200, { recoveryCodes: CODES });
  routes['/v1/auth/session'] = json(200, { user: { id: 'u1' } });
  routes['/v1/query'] = json(200, { data: null });
  expect(await step({ intent: 'recheck', purpose: 'regen', code: '123456' })).toMatchObject({ step: 'codes', codes: CODES, reason: 'regen', name: null });
  expect(bodyOf(calls('/v1/auth/mfa/recovery-codes')[0])).toEqual({ code: '123456' });
  routes['/v1/auth/mfa/recovery-codes'] = err(403, 'forbidden', 'wrong_code');
  expect(await step({ intent: 'recheck', purpose: 'regen', code: '123456' })).toEqual({ step: 'recheck', purpose: 'regen', mode: 'otp', error: 'wrong' });
  routes['/v1/auth/mfa/recovery-codes'] = err(429, 'rate_limited', 'mfa_locked', { lockScope: 'account', retryAfterMinutes: 9 });
  expect(await step({ intent: 'recheck', purpose: 'regen', code: '123456' })).toMatchObject({ notice: { kind: 'locked', lockScope: 'account', minutes: 9 } });
});

test('복구 코드 [관리자 화면으로]: 보관 확인 실패해도 /admin, 바꾸기 완료도 /admin', async () => {
  routes['/v1/auth/mfa/recovery-codes/ack'] = err(503, 'unavailable', 'unavailable');
  expect(await settle(step({ intent: 'ack' }))).toBe('REDIRECT:/admin');
  expect(calls('/v1/auth/mfa/recovery-codes/ack')).toHaveLength(1);
  expect(await settle(step({ intent: 'done' }))).toBe('REDIRECT:/admin');
});

// ---- M5 resetAdminMfa ----

const TARGET = '44444444-4444-4444-8444-444444444444';
const GOOD = { identityChecked: 'on', reason: 'lost_phone', memo: '', code: '123 456' };
const reset = (over: Record<string, string | undefined> = {}) => {
  const f = { ...GOOD, ...over } as Record<string, string>;
  for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  return resetAdminMfa(TARGET, undefined, form(f));
};

test('초기화 입력 검사(API 없음): 본인 확인 체크, 사유, 기타면 메모 5자 이상, 메모 200자, 내 번호 6자리 — 빠진 칸 모두', async () => {
  expect(await reset({ identityChecked: undefined, reason: undefined, code: '12' })).toEqual({ done: false, fields: ['check', 'reason', 'code_format'] });
  expect(await reset({ reason: 'other', memo: '짧음' })).toEqual({ done: false, fields: ['memo'] });
  expect(await reset({ reason: 'weird' })).toEqual({ done: false, fields: ['reason'] });
  expect(await reset({ memo: 'x'.repeat(201) })).toEqual({ done: false, fields: ['memo_long'] });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('초기화 성공: 본문(code·reason·identityChecked, 메모는 있을 때만), 등록 코드 한 번 + 유효 시각, 상세·운영자 목록 다시 그림', async () => {
  routes[`/v1/admin/users/${TARGET}/mfa-reset`] = json(200, { enrollTicket: '12345678', ticketExpiresAt: '2026-11-27T05:12:00.000Z' });
  const r = await reset({ reason: 'other', memo: '휴대폰 고장으로 교체' });
  expect(r).toMatchObject({ done: true, ticket: '12345678' });
  expect(r && r.done && r.validUntil).toMatch(/오후 2시 12분$/);
  expect(bodyOf(calls(`/v1/admin/users/${TARGET}/mfa-reset`)[0])).toEqual({ code: '123456', reason: 'other', identityChecked: true, memo: '휴대폰 고장으로 교체' });
  expect(revalidatePath).toHaveBeenCalledWith(`/admin/members/${TARGET}`);
  expect(revalidatePath).toHaveBeenCalledWith('/admin/operators');
  await reset();
  expect(bodyOf(calls(`/v1/admin/users/${TARGET}/mfa-reset`)[1])).toEqual({ code: '123456', reason: 'lost_phone', identityChecked: true });
});

test('초기화 실패 → 화면 상태(4.6.1 오류 전부)', async () => {
  const cases: Array<[Response, unknown]> = [
    [err(403, 'forbidden', 'wrong_code'), { done: false, fields: ['code_wrong'] }],
    [err(403, 'forbidden', 'code_reused'), { done: false, fields: ['code_used'] }],
    [err(400, 'validation', 'memo', { field: 'memo' }), { done: false, fields: ['memo'] }],
    [err(429, 'rate_limited', 'mfa_locked', { lockScope: 'account', retryAfterMinutes: 14.2 }), { done: false, lock: { lockScope: 'account', minutes: 15 } }],
    [err(429, 'rate_limited', 'mfa_locked', { lockScope: 'daily', retryAfterMinutes: 1440 }), { done: false, lock: { lockScope: 'daily', minutes: 1440 } }],
    [err(429, 'rate_limited', '요청이 많아요'), { done: false, notice: 'rate_limited' }],
    [err(409, 'conflict', 'target_not_admin'), { done: false, notice: 'target_changed' }],
    [err(409, 'conflict', 'target_withdrawn'), { done: false, notice: 'target_changed' }],
    [err(404, 'not_found', 'not_found'), { done: false, notice: 'target_changed' }],
    [err(409, 'conflict', 'self_reset'), { done: false, notice: 'self' }],
    [err(503, 'unavailable', 'log_failed'), { done: false, notice: 'log_failed' }],
    [err(503, 'unavailable', 'unavailable'), { done: false, notice: 'unavailable' }],
    [err(401, 'unauthenticated', '로그인이 필요합니다.'), { done: false, notice: 'session' }],
    [err(403, 'forbidden', 'mfa_session_required'), { done: false, notice: 'need_mfa' }],
    [err(500, 'internal', 'x'), { done: false, notice: 'failed' }],
  ];
  for (const [res, want] of cases) {
    routes[`/v1/admin/users/${TARGET}/mfa-reset`] = res;
    expect(await reset(), JSON.stringify(want)).toEqual(want);
  }
  // 옛 API(경로 없음): 연결 불가로 보여 준다(초기화되지 않았음)
  delete routes[`/v1/admin/users/${TARGET}/mfa-reset`];
  expect(await reset()).toEqual({ done: false, notice: 'unavailable' });
  expect(revalidatePath).not.toHaveBeenCalled();
});
