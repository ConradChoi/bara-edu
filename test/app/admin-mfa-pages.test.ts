import { beforeEach, expect, test, vi } from 'vitest';
import { createElement, type ComponentProps, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ---- 관리자 화면의 2단계 인증: M4 내 보안 설정, M5 카드, M6 배너·메뉴, M7 보안 이벤트, 운영자 목록 열 ----
// 배포 순서(앱 → DB 패치 → API) 동안 지금의 운영 API(2단계 인증 경로 없음 404)와도 지금 화면 그대로여야 한다.
const jar = new Map<string, string>([['bara_session', 'admin-tok']]);
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined), set: vi.fn(), delete: vi.fn() }),
  headers: async () => ({ get: () => null }),
}));
vi.mock('@/lib/db/service-key', () => ({ getServiceKey: async () => 'svc-key' }));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  usePathname: () => '/admin/security',
}));
vi.mock('@/lib/supabase/require-admin', () => ({ requireAdminClient: async () => ({}) }));

let actionState: unknown = undefined;
vi.mock('react', async (orig) => {
  const actual = await orig<typeof import('react')>();
  return { ...actual, default: actual, useActionState: (_a: unknown, init: unknown) => [actionState ?? init, vi.fn(), false] };
});

import SecurityPage from '@/app/(admin)/admin/security/page';
import OperatorsPage from '@/app/(admin)/admin/operators/page';
import AdminShell from '@/components/admin/AdminShell';
import AdminMfaCard from '@/components/admin/AdminMfaCard';
import MfaBanner from '@/components/admin/MfaBanner';
import SecurityEventsCard from '@/components/admin/SecurityEventsCard';
import { MFA_COPY as C, MFA_COPY_PENDING_REVIEW as P } from '@/lib/mfa-copy';
import { adminMfaChrome } from '@/lib/mfa-format';
import { getAdminSecurityEvents } from '@/lib/supabase/admin-queries';

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const OLD_API_404 = () => json(404, { error: { code: 'not_found', message: '요청한 경로를 찾을 수 없습니다.' } });
type Body = { table?: string; filters?: unknown[] };
let routes: Record<string, (body: Body) => Response> = {};

beforeEach(() => {
  routes = {};
  actionState = undefined;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const r = routes[new URL(url).pathname];
    return r ? r(JSON.parse(String(init.body ?? '{}'))) : OLD_API_404();
  });
  vi.stubGlobal('fetch', fetchMock);
  process.env.BARA_API_URL = 'http://api.local';
});

const STATUS = {
  mode: 'enforce',
  enrolled: true,
  enrolledAt: '2026-11-30T15:30:00.000Z',
  lastUsedAt: null,
  recoveryCodesLeft: 2,
  recoveryCodesAcked: true,
  canSelfEnroll: false,
  graceUntil: null,
  signedInWithRecovery: false,
  sessionExpiresAt: null,
};
const page = async (start?: string) => renderToStaticMarkup((await SecurityPage({ searchParams: Promise.resolve(start ? { start } : {}) })) as ReactElement);
// children은 createElement의 세 번째 인자로 넘긴다
const shellProps = (mfa: ReturnType<typeof adminMfaChrome>) => ({ adminName: '관리자', mfa }) as ComponentProps<typeof AdminShell>;
const sessionOk = () => json(200, { user: { id: 'me', email: 'a@b.kr' } });

test('호환: 상태 조회가 404(지금의 운영 API)면 배너·"내 보안 설정" 메뉴가 없다 — 지금의 관리자 화면과 같다', () => {
  const chrome = adminMfaChrome({ ok: false, reason: 'unsupported' });
  expect(chrome).toEqual({ banner: null, showSecurityMenu: false });
  const h = renderToStaticMarkup(createElement(AdminShell, shellProps(chrome), 'x'));
  expect(h).not.toContain('내 보안 설정');
  expect(h).not.toContain('role="status"');
  // 다른 조회 실패면 메뉴는 두고(화면이 실패를 알린다) 배너만 없다
  expect(adminMfaChrome({ ok: false, reason: 'unavailable' })).toEqual({ banner: null, showSecurityMenu: true });
  const ok = renderToStaticMarkup(createElement(AdminShell, shellProps(adminMfaChrome({ ok: true, status: { ...STATUS, mode: 'off' } as never })), 'x'));
  expect(ok).toContain('href="/admin/security"');
  expect(ok).toContain(C['MFA-BANNER-MODE-OFF']);
});

test('호환: /admin/security는 404면 "준비 중"(버튼·이벤트 없음)', async () => {
  routes['/v1/auth/session'] = sessionOk;
  const h = await page();
  expect(h).toContain(P['APP-MFA-NOT-READY-TITLE']);
  expect(h).not.toContain('name="intent"');
  expect(h).not.toContain(C['MFA-EVENT-TITLE']);
});

test('M4 조회 실패: MFA-SEC-LOADERR + 버튼 숨김', async () => {
  routes['/v1/auth/session'] = sessionOk;
  routes['/v1/auth/mfa/status'] = () => json(503, { error: { code: 'unavailable', message: 'unavailable' } });
  const h = await page();
  expect(h).toContain(C['MFA-SEC-LOADERR']);
  expect(h).not.toContain('name="intent"');
});

test('M4 등록됨: 상태 배지(글자)·등록일·복구 코드 3개 이하 경고, [인증 앱 바꾸기]·[복구 코드 새로 받기](채운 버튼 없음), 끌 수 없음 안내, 내 보안 이벤트', async () => {
  routes['/v1/auth/session'] = sessionOk;
  routes['/v1/auth/mfa/status'] = () => json(200, STATUS);
  routes['/v1/query'] = (b) => json(200, { data: b.table === 'admin_access_logs' ? [] : [] });
  const h = await page();
  expect(h).toContain('>등록됨<');
  expect(h).toContain('등록됨 · 등록일 2026년 12월 1일 · 마지막 사용 -');
  expect(h).toContain('복구 코드가 2개 남았어요. 새로 받아 두세요.');
  expect(h).toContain('name="intent" value="change"');
  expect(h).toContain('name="intent" value="regen"');
  expect(h).not.toContain('value="enroll"');
  expect(h).toContain(C['MFA-SEC-NOOFF']);
  expect(h).toContain(C['MFA-EVENT-EMPTY']);
  // 내 것만 조회한다
  const q = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/v1/query') && JSON.parse(String(c[1].body)).table === 'admin_access_logs');
  expect(JSON.stringify(JSON.parse(String(q![1].body)).filters)).toContain('"target_user_id"');
});

test('M4 미등록(유예): [지금 등록하기] 하나만 채운 버튼, ?start=enroll이면 바로 앱 준비(3단계 진행)', async () => {
  routes['/v1/auth/session'] = sessionOk;
  routes['/v1/auth/mfa/status'] = () => json(200, { ...STATUS, mode: 'optional', enrolled: false, canSelfEnroll: true, graceUntil: '2026-12-03T00:00:00+09:00' });
  routes['/v1/query'] = () => json(200, { data: [] });
  let h = await page();
  expect(h).toContain('아직 등록하지 않았어요. 12월 3일까지 등록해 주세요.');
  expect(h).toContain('name="intent" value="enroll"');
  h = await page('enroll');
  expect(h).toContain('1/3단계: 앱 준비');
  expect(h).toContain('<h2 tabindex="-1"');
  expect(h).toContain(C['MFA-SETUP-BACK']);
});

test('M4 ?start=change: 복구 코드로 로그인한 세션이면 복구 코드 칸으로 시작, 남은 코드가 없으면 MFA-CHANGE-NORC', async () => {
  routes['/v1/auth/session'] = sessionOk;
  routes['/v1/query'] = () => json(200, { data: [] });
  routes['/v1/auth/mfa/status'] = () => json(200, { ...STATUS, signedInWithRecovery: true, recoveryCodesLeft: 4 });
  let h = await page('change');
  expect(h).toContain(C['MFA-CHANGE-RC-LABEL']);
  expect(h).toContain(C['MFA-CHANGE-USE-OTP']);
  routes['/v1/auth/mfa/status'] = () => json(200, { ...STATUS, recoveryCodesLeft: 0 });
  h = await page('change');
  expect(h).toContain(C['MFA-SEC-RECHECK-LABEL']);
  expect(h).toContain(C['MFA-CHANGE-NORC']);
  h = await page('recovery-codes');
  expect(h).toContain(C['MFA-SEC-BTN-RC-HELP']);
  expect(h).not.toContain(C['MFA-CHANGE-USE-RC']);
});

test('M6 배너: 종류별 문구·톤·버튼(목적지는 /admin/security?start=…), role=status, 닫기 없음', () => {
  const r = (b: Parameters<typeof MfaBanner>[0]['banner']) => renderToStaticMarkup(createElement(MfaBanner, { banner: b }));
  let h = r({ kind: 'recovery_used', left: 4 });
  expect(h).toContain('role="status"');
  expect(h).toContain('복구 코드로 로그인했어요. 남은 복구 코드는 4개예요.');
  expect(h).toContain('href="/admin/security?start=change"');
  h = r({ kind: 'recovery_zero' });
  expect(h).toContain(C['MFA-REC-DONE-ZERO']);
  expect(h).not.toContain('href=');
  h = r({ kind: 'grace', days: 7, date: '12월 3일' });
  expect(h).toContain('<span class="sr-only">2단계 인증 안내. </span>7일 뒤부터 관리자 로그인에 인증 앱 번호가 필요해요. 지금 등록해 주세요. 12월 3일부터 필수예요.');
  expect(h).toContain('href="/admin/security?start=enroll"');
  expect(r({ kind: 'grace', days: 1, date: null })).toContain(C['MFA-BANNER-GRACE-1']);
  expect(r({ kind: 'grace', days: 0, date: null })).toContain(C['MFA-BANNER-GRACE-0']);
  h = r({ kind: 'rc_low', left: 2 });
  expect(h).toContain('복구 코드가 2개 남았어요. 새로 받아 두세요.');
  expect(h).toContain('href="/admin/security?start=recovery-codes"');
  expect(r({ kind: 'rc_not_saved' })).toContain(C['MFA-BANNER-RCNOTSAVED']);
  expect(r({ kind: 'mode_optional', date: '12월 3일' })).toContain('12월 3일부터 모든 관리자에게 필요해요.');
  expect(r({ kind: 'mode_optional', date: null })).not.toContain('{date}');
  expect(r({ kind: 'mode_off' })).toContain(C['MFA-BANNER-MODE-OFF']);
});

test('M5 카드: 등록됨 → [2단계 인증 초기화], 미등록·초기화됨 → [등록 코드 만들기], 나 자신 → 내 보안 설정 링크, 조회 실패 → LOADERR', () => {
  const r = (p: Parameters<typeof AdminMfaCard>[0]) => renderToStaticMarkup(createElement(AdminMfaCard, p));
  const base = { targetId: 't1', targetName: '박관리', isSelf: false };
  let h = r({ ...base, info: { state: 'enrolled', stateText: '등록됨 · 등록일 2026년 12월 1일 · 마지막 사용 오늘 오후 2시 12분' } });
  expect(h).toContain('>등록됨<');
  expect(h).toContain(C['MFA-RESET-BTN']);
  expect(h).not.toContain('name="code"');
  h = r({ ...base, info: { state: 'reset_pending', stateText: '초기화됨' } });
  expect(h).toContain(C['MFA-RESET-BTN-TICKET']);
  h = r({ ...base, isSelf: true, info: { state: 'enrolled', stateText: 'x' } });
  expect(h).toContain('href="/admin/security"');
  expect(h).not.toContain(C['MFA-RESET-BTN']);
  h = r({ ...base, info: null });
  expect(h).toContain(C['MFA-RESET-LOADERR']);
});

test('M5 결과: 등록 코드 8자리(4자리씩, 띄어 읽기), 유효 시각, 다시 볼 수 없음, 복사 버튼 없음', () => {
  actionState = { done: true, ticket: '12345678', validUntil: '내일 오후 2시 12분' };
  const h = renderToStaticMarkup(createElement(AdminMfaCard, { targetId: 't1', targetName: '박관리', isSelf: false, info: { state: 'enrolled', stateText: 'x' } }));
  expect(h).toContain('>1234 5678<');
  expect(h).toContain('등록 코드는 1 2 3 4, 5 6 7 8이에요.');
  expect(h).toContain('내일 오후 2시 12분까지, 한 번만 쓸 수 있어요.');
  expect(h).toContain('아래 등록 코드를 박관리님께 전화로 불러 주세요.');
  expect(h).toContain(C['MFA-RESET-DONE-ONCE']);
  expect(h).not.toMatch(/복사/);
});

test('M7 카드: 조회 실패·빈 값·사건 한 줄(사유는 괄호, 알림 대상 없음 표시, IP·detail 원문 없음)', () => {
  const r = (events: Parameters<typeof SecurityEventsCard>[0]['events']) => renderToStaticMarkup(createElement(SecurityEventsCard, { events, now: Date.parse('2026-11-26T06:00:00Z') }));
  expect(r(null)).toContain(C['MFA-EVENT-LOADERR']);
  expect(r([])).toContain(C['MFA-EVENT-EMPTY']);
  const h = r([
    { id: '1', at: '2026-11-26T05:12:00.000Z', targetName: '박관리', kind: 'reset', reason: 'lost_phone', selfOnly: false },
    { id: '2', at: '2026-11-25T01:00:00.000Z', targetName: '김관리', kind: 'locked_daily', reason: null, selfOnly: true },
  ]);
  expect(h).toContain('오늘 오후 2시 12분');
  expect(h).toContain('2단계 인증 초기화 (휴대폰을 잃어버렸어요)');
  expect(h).toContain(C['MFA-EVENT-LOCKED-DAILY']);
  expect(h).toContain(C['MFA-EVENT-SELFONLY']);
});

test('M7 조회: 최근 7일·사건 action만(로그인은 mfa=recovery만), 최신 20건, 이름은 profiles에서, 사유·잠김 범위·self_only만 뽑는다', async () => {
  const rows = [
    { id: 'a', target_user_id: 'u1', action: '2단계인증초기화', detail: 'reason=new_phone;by=admin;alert=self_only', created_at: '2026-11-26T05:00:00Z' },
    { id: 'b', target_user_id: 'u2', action: '2단계인증잠김', detail: 'limit=daily', created_at: '2026-11-26T04:00:00Z' },
    { id: 'c', target_user_id: 'u2', action: '로그인', detail: 'mfa=recovery;left=7', created_at: '2026-11-26T03:00:00Z' },
    { id: 'd', target_user_id: null, action: '2단계인증등록', detail: 'via=session', created_at: '2026-11-26T02:00:00Z' },
  ];
  const bodies: Body[] = [];
  routes['/v1/query'] = (b) => {
    bodies.push(b);
    return json(200, { data: b.table === 'admin_access_logs' ? rows : [{ id: 'u1', name: '박관리' }, { id: 'u2', name: '김관리' }] });
  };
  const ev = await getAdminSecurityEvents({ now: Date.parse('2026-11-26T06:00:00Z') });
  expect(ev).toEqual([
    { id: 'a', at: rows[0].created_at, targetName: '박관리', kind: 'reset', reason: 'new_phone', selfOnly: true },
    { id: 'b', at: rows[1].created_at, targetName: '김관리', kind: 'locked_daily', reason: null, selfOnly: false },
    { id: 'c', at: rows[2].created_at, targetName: '김관리', kind: 'recovery', reason: null, selfOnly: false },
    { id: 'd', at: rows[3].created_at, targetName: null, kind: 'enrolled', reason: null, selfOnly: false },
  ]);
  const q = JSON.stringify(bodies[0]);
  expect(q).toContain('"2026-11-19T06:00:00.000Z"');
  expect(q).toContain('mfa=recovery%');
  expect(q).toContain('"limit":20');
  expect(q).not.toContain('ip_address');
  routes['/v1/query'] = () => json(500, { error: { code: 'internal', message: 'x' } });
  expect(await getAdminSecurityEvents()).toBeNull();
});

test('운영자 목록: "2단계 인증" 열은 overview가 될 때만(옛 API 404면 지금 표 그대로)', async () => {
  routes['/v1/query'] = (b) =>
    json(200, {
      data: b.table === 'profiles' ? [{ id: 'u1', name: '박관리', email: 'p@b.kr', phone: null, created_at: '2026-01-01T00:00:00Z', status: 'active', role: 'admin' }] : [],
      count: 1,
    });
  routes['/v1/admin/auth/email-confirmations'] = () => json(200, { items: [] });
  const render = async () => renderToStaticMarkup((await OperatorsPage({ searchParams: Promise.resolve({}) })) as ReactElement);
  let h = await render();
  expect(h).not.toContain('<th>2단계 인증</th>');
  routes['/v1/admin/mfa/overview'] = () => json(200, { items: [{ userId: 'u1', state: 'reset_pending' }] });
  h = await render();
  expect(h).toContain('<th>2단계 인증</th>');
  expect(h).toContain('>초기화됨<');
});
