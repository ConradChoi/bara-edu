import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { setupTestDb } from './helpers/db.js';
import { addUser, caller, clearLastStep, codeAt, enrollDirect, logsOf, mfaApp, mfaSession, PASSWORD, RING_V1, setRole } from './helpers/mfa.js';
import type { MemoryMailer } from '../src/mail/mailer.js';
import type { MfaMode } from '../src/config.js';

// 관리자 2단계 인증: 로그인 분기(4.1), verify(4.2), recover(4.3), 재사용(2.8), 시도 제한(2.9), guard(2.3·4.9).
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
const apps = {} as Record<MfaMode, { app: FastifyInstance; mailer: MemoryMailer; call: ReturnType<typeof caller> }>;

beforeAll(async () => {
  ctx = await setupTestDb();
  for (const mode of ['off', 'optional', 'enforce'] as const) {
    const a = mfaApp(ctx, { mode, grace: '2026-12-03T00:00:00+09:00' });
    await a.app.ready();
    apps[mode] = { ...a, call: caller(a.app) };
  }
});
afterAll(async () => {
  for (const a of Object.values(apps)) await a.app.close();
  await ctx.close();
});
beforeEach(async () => {
  await ctx.adminPool.query('truncate auth.rate_events');
  for (const a of Object.values(apps)) a.mailer.sent.length = 0;
});

const q = async (sql: string, p: unknown[] = []) => (await ctx.adminPool.query(sql, p)).rows;
const login = (mode: MfaMode, email: string, password = PASSWORD, h: Record<string, string> = {}) => apps[mode].call('POST', '/v1/auth/login', { email, password }, h);
const sessionGet = (mode: MfaMode, token: string, h: Record<string, string> = {}) => apps[mode].call('GET', '/v1/auth/session', undefined, { 'x-bara-session': token, ...h });

type State = 'enrolled' | 'ticket' | 'fresh';
async function adminIn(state: State) {
  const u = await addUser(ctx, { admin: true });
  let secret: Buffer | null = null;
  if (state === 'enrolled') secret = await enrollDirect(ctx, RING_V1, u.id);
  if (state === 'ticket') await q('insert into auth.mfa_account_state (user_id, ticket_required_at, ever_enrolled_at, reset_at) values ($1, now(), now(), now())', [u.id]);
  return { ...u, secret };
}
async function challengeFor(email: string, mode: MfaMode = 'enforce') {
  const r = await login(mode, email);
  expect(r.statusCode).toBe(200);
  expect(r.json().mfa).toBe('required');
  return r.json().challengeToken as string;
}

// ---- 4.1 로그인 분기: 2.2 표의 9칸

const EXPECT: Record<MfaMode, Record<State, 'session' | 'required' | 'enroll_required'>> = {
  off: { enrolled: 'session', ticket: 'enroll_required', fresh: 'session' },
  optional: { enrolled: 'required', ticket: 'enroll_required', fresh: 'session' },
  enforce: { enrolled: 'required', ticket: 'enroll_required', fresh: 'enroll_required' },
};

for (const mode of ['off', 'optional', 'enforce'] as const) {
  for (const state of ['enrolled', 'ticket', 'fresh'] as const) {
    test(`로그인 분기 ${mode} × ${state} → ${EXPECT[mode][state]}`, async () => {
      const a = await adminIn(state);
      const r = await login(mode, a.email, PASSWORD, { 'x-bara-client-ip': '203.0.113.5' });
      expect(r.statusCode).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      const b = r.json();
      const want = EXPECT[mode][state];
      if (want === 'session') {
        expect(Object.keys(b).sort()).toEqual(['expiresAt', 'sessionToken', 'userId']);
        const hours = (new Date(b.expiresAt).getTime() - Date.now()) / 3_600_000;
        expect(hours).toBeGreaterThan(11.9);
        expect(hours).toBeLessThanOrEqual(12);
        const [s] = await q('select mfa_at, mfa_method from auth.sessions where user_id = $1', [a.id]);
        expect(s).toEqual({ mfa_at: null, mfa_method: null });
        expect((await logsOf(ctx, a.id)).at(-1)).toMatchObject({ action: '로그인', detail: `mfa=none;mode=${mode}`, ip_address: '203.0.113.5' });
        expect((await sessionGet(mode, b.sessionToken)).statusCode).toBe(200);
      } else {
        expect(b.sessionToken).toBeUndefined();
        expect(b.mfa).toBe(want);
        expect(b.challengeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
        const ttl = (new Date(b.challengeExpiresAt).getTime() - Date.now()) / 60_000;
        expect(ttl).toBeLessThanOrEqual(want === 'required' ? 5 : 15);
        expect(ttl).toBeGreaterThan(want === 'required' ? 4.9 : 14.9);
        if (want === 'enroll_required') expect(b.enrollReason).toBe(state === 'ticket' ? 'reset' : 'first');
        else expect(b.enrollReason).toBeUndefined();
        expect(await q('select 1 from auth.sessions where user_id = $1', [a.id])).toHaveLength(0);
        const [c] = await q('select token_hash, purpose, ip from auth.mfa_challenges where user_id = $1', [a.id]);
        expect(c.token_hash).toBe(createHash('sha256').update(b.challengeToken).digest('hex'));
        expect(c.purpose).toBe(want === 'required' ? 'verify' : 'enroll');
        expect(c.ip).toBe('203.0.113.5');
      }
    });
  }
}

test('enforce에서 이력 없는 관리자가 로그인하면 ticket_required_at이 생겨, 이후 optional로 되돌려도 입구 A가 열리지 않는다', async () => {
  const a = await adminIn('fresh');
  expect((await login('enforce', a.email)).json().mfa).toBe('enroll_required');
  expect((await q('select ticket_required_at from auth.mfa_account_state where user_id = $1', [a.id]))[0].ticket_required_at).not.toBeNull();
  const r = await login('optional', a.email);
  expect(r.json()).toMatchObject({ mfa: 'enroll_required', enrollReason: 'first' });
});

test('비밀번호가 틀리면 관리자 여부가 드러나지 않는다(학습자와 같은 응답)', async () => {
  const a = await adminIn('enrolled');
  const l = await addUser(ctx);
  const ra = await login('enforce', a.email, 'wrong-pass');
  const rl = await login('enforce', l.email, 'wrong-pass');
  expect(ra.statusCode).toBe(401);
  expect(ra.json()).toEqual(rl.json());
  expect(await q('select 1 from auth.mfa_challenges where user_id = $1', [a.id])).toHaveLength(0);
});

test('학습자 로그인은 바뀌지 않는다(30일 세션, mfa 필드 없음)', async () => {
  const l = await addUser(ctx);
  const b = (await login('enforce', l.email)).json();
  expect(Object.keys(b).sort()).toEqual(['expiresAt', 'sessionToken', 'userId']);
  expect(new Date(b.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
});

// ---- 4.2 verify

test('verify 성공: 12시간 세션(mfa_at·totp), 대기표 1회용, 접속 기록 로그인 mfa=totp', async () => {
  const a = await adminIn('enrolled');
  const ch = await challengeFor(a.email);
  const r = await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: codeAt(a.secret!) }, { 'x-bara-client-ip': '198.51.100.7' });
  expect(r.statusCode).toBe(200);
  expect(r.headers['cache-control']).toBe('no-store');
  expect(Object.keys(r.json()).sort()).toEqual(['expiresAt', 'sessionToken', 'userId']);
  const [s] = await q('select mfa_method, mfa_at is not null as has, expires_at - created_at as ttl from auth.sessions where user_id = $1', [a.id]);
  expect(s.mfa_method).toBe('totp');
  expect(s.has).toBe(true);
  expect(s.ttl.hours).toBe(12);
  expect((await logsOf(ctx, a.id)).at(-1)).toMatchObject({ action: '로그인', detail: 'mfa=totp', ip_address: '198.51.100.7' });
  expect((await sessionGet('enforce', r.json().sessionToken)).json().profile.role).toBe('admin');
  // 같은 대기표 다시 → challenge_invalid
  await clearLastStep(ctx, a.id);
  const again = await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: codeAt(a.secret!) });
  expect(again.statusCode).toBe(401);
  expect(again.json().error).toMatchObject({ code: 'unauthenticated', message: 'challenge_invalid' });
});

test('verify 형식 오류는 400 field code(실패 횟수 안 셈), 공백·하이픈은 허용', async () => {
  const a = await adminIn('enrolled');
  const ch = await challengeFor(a.email);
  for (const code of ['12345', 'abcdef', '', 1234567]) {
    const r = await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatchObject({ code: 'validation', field: 'code' });
  }
  expect((await q('select fail_count from auth.mfa_challenges where user_id = $1', [a.id]))[0].fail_count).toBe(0);
  const c = codeAt(a.secret!);
  const r = await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: `${c.slice(0, 3)} - ${c.slice(3)}` });
  expect(r.statusCode).toBe(200);
});

test('verify: 학습자 대기표·enroll 대기표·만료 대기표는 challenge_invalid', async () => {
  const a = await adminIn('ticket');
  const enrollCh = (await login('enforce', a.email)).json().challengeToken;
  const r = await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: enrollCh, code: '123456' });
  expect(r.json().error.message).toBe('challenge_invalid');
  const b = await adminIn('enrolled');
  const ch = await challengeFor(b.email);
  await q("update auth.mfa_challenges set expires_at = now() - interval '1 second' where user_id = $1", [b.id]);
  expect((await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: codeAt(b.secret!) })).json().error.message).toBe('challenge_invalid');
});

test('verify: 2단계 화면에 있는 동안 초기화·강등·탈퇴·off 전환 → 401 account_changed, 대기표 폐기', async () => {
  const cases: Array<[string, (id: string) => Promise<unknown>, MfaMode]> = [
    ['초기화', (id) => q('delete from auth.mfa_factors where user_id = $1', [id]), 'enforce'],
    ['강등', (id) => setRole(ctx, id, 'learner'), 'enforce'],
    ['탈퇴', (id) => ctx.adminPool.query(`begin; set local session_replication_role = replica; update profiles set status='withdrawn' where id='${id}'; commit`), 'enforce'],
    ['off 전환', async () => {}, 'off'],
  ];
  for (const [, change, mode] of cases) {
    const a = await adminIn('enrolled');
    const ch = await challengeFor(a.email);
    await change(a.id);
    const r = await apps[mode].call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: codeAt(a.secret!) });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.message).toBe('account_changed');
    expect(await q('select 1 from auth.mfa_challenges where user_id = $1', [a.id])).toHaveLength(0);
  }
});

// ---- 2.8 재사용

test('재사용: 같은 칸의 번호를 다시 내면 403 code_reused(횟수 안 셈, mfa-fail 없음), ±1 밖의 옛 번호는 wrong_code', async () => {
  const a = await adminIn('enrolled');
  const code = codeAt(a.secret!);
  expect((await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: await challengeFor(a.email), code })).statusCode).toBe(200);
  const ch = await challengeFor(a.email);
  const r = await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code });
  expect(r.statusCode).toBe(403);
  expect(r.json().error).toMatchObject({ code: 'forbidden', message: 'code_reused', attemptsLeft: 5 });
  expect((await q('select fail_count from auth.mfa_challenges where user_id = $1 and used_at is null', [a.id]))[0].fail_count).toBe(0);
  expect(await q("select 1 from auth.rate_events where key = $1 and bucket like 'mfa-fail%'", [a.id])).toHaveLength(0);
  const old = await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: codeAt(a.secret!, -3) });
  expect(old.json().error).toMatchObject({ message: 'wrong_code', attemptsLeft: 4 });
});

// ---- 4.3 recover

async function issueCodes(a: { id: string; email: string; secret: Buffer | null }): Promise<string[]> {
  const token = await mfaSession(ctx, a.id);
  await clearLastStep(ctx, a.id);
  const r = await apps.enforce.call('POST', '/v1/auth/mfa/recovery-codes', { code: codeAt(a.secret!) }, { 'x-bara-session': token });
  expect(r.statusCode).toBe(200);
  await clearLastStep(ctx, a.id);
  return r.json().recoveryCodes;
}

test('recover: 소문자·하이픈·공백 정규화, 1회용(원자적), 세션 mfa_method=recovery, 기록 left=n, 이미 쓴 코드는 wrong_code(횟수 셈)', async () => {
  const a = await adminIn('enrolled');
  const codes = await issueCodes(a);
  expect(codes).toHaveLength(10);
  for (const c of codes) expect(c).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
  const messy = ` ${codes[0].toLowerCase().replace('-', ' - ')} `;
  const r = await apps.enforce.call('POST', '/v1/auth/mfa/recover', { challengeToken: await challengeFor(a.email), recoveryCode: messy });
  expect(r.statusCode).toBe(200);
  expect(r.json().recoveryCodesLeft).toBe(9);
  expect((await q('select mfa_method from auth.sessions where token_hash = $1', [createHash('sha256').update(r.json().sessionToken).digest('hex')]))[0].mfa_method).toBe('recovery');
  expect((await logsOf(ctx, a.id)).at(-1)).toMatchObject({ action: '로그인', detail: expect.stringMatching(/^mfa=recovery;left=9/) });
  const again = await apps.enforce.call('POST', '/v1/auth/mfa/recover', { challengeToken: await challengeFor(a.email), recoveryCode: codes[0] });
  expect(again.json().error).toMatchObject({ code: 'forbidden', message: 'wrong_code', attemptsLeft: 4 });
  expect(await q("select 1 from auth.rate_events where key = $1 and bucket = 'mfa-fail'", [a.id])).toHaveLength(1);
  // 형식이 아닌 값도 추측 시도로 센다. 빈 값은 400
  const ch = await challengeFor(a.email);
  expect((await apps.enforce.call('POST', '/v1/auth/mfa/recover', { challengeToken: ch, recoveryCode: 'IIIIIOOOOO' })).json().error.message).toBe('wrong_code');
  expect((await apps.enforce.call('POST', '/v1/auth/mfa/recover', { challengeToken: ch, recoveryCode: '' })).json().error).toMatchObject({ code: 'validation', field: 'recoveryCode' });
});

test('recover: 동시에 같은 코드를 두 번 내면 하나만 성공한다', async () => {
  const a = await adminIn('enrolled');
  const codes = await issueCodes(a);
  const [c1, c2] = [await challengeFor(a.email), await challengeFor(a.email)];
  const rs = await Promise.all([c1, c2].map((ch) => apps.enforce.call('POST', '/v1/auth/mfa/recover', { challengeToken: ch, recoveryCode: codes[3] })));
  expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 403]);
});

// ---- 2.9 시도 제한

test('대기표당 5회: 4번째까지 wrong_code(attemptsLeft 4..1), 5번째 401 challenge_exhausted, 그 뒤 challenge_invalid', async () => {
  const a = await adminIn('enrolled');
  const ch = await challengeFor(a.email);
  const wrong = codeAt(a.secret!, 5);
  for (let left = 4; left >= 1; left--) {
    expect((await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: wrong })).json().error).toMatchObject({ message: 'wrong_code', attemptsLeft: left });
  }
  const fifth = await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: wrong });
  expect(fifth.statusCode).toBe(401);
  expect(fifth.json().error.message).toBe('challenge_exhausted');
  expect((await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: codeAt(a.secret!) })).json().error.message).toBe('challenge_invalid');
});

test('계정 15분 10회: 여러 대기표에 걸쳐 10번째에 429 mfa_locked(account), 기록 1번, 잠긴 뒤에는 맞는 번호도 비교하지 않는다', async () => {
  const a = await adminIn('enrolled');
  const wrong = codeAt(a.secret!, 5);
  let last: { ch: string; r: Awaited<ReturnType<typeof login>> } | undefined;
  for (let i = 0; i < 10; i++) {
    // 대기표 하나는 4번까지만 쓴다(5번째면 대기표가 폐기되므로 계정 한도와 섞이지 않게)
    const ch = i % 4 === 0 || !last ? await challengeFor(a.email) : last.ch;
    const r = await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: wrong });
    if (i < 9) expect(r.json().error.message).toBe('wrong_code');
    last = { ch, r };
  }
  expect(last!.r.statusCode).toBe(429);
  expect(last!.r.json().error).toMatchObject({ code: 'rate_limited', message: 'mfa_locked', lockScope: 'account' });
  expect(last!.r.json().error.retryAfterMinutes).toBeGreaterThanOrEqual(14);
  expect(last!.r.json().error.retryAfterMinutes).toBeLessThanOrEqual(15);
  const ok = await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: await challengeFor(a.email), code: codeAt(a.secret!) });
  expect(ok.statusCode).toBe(429);
  expect((await logsOf(ctx, a.id)).filter((l) => l.action === '2단계인증잠김')).toEqual([expect.objectContaining({ detail: expect.stringMatching(/^limit=account/) })]);
  // 15분이 지나면 다시 된다(24시간 누적 30회 미만)
  await q("update auth.rate_events set created_at = now() - interval '16 minutes' where key = $1", [a.id]);
  expect((await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: await challengeFor(a.email), code: codeAt(a.secret!) })).statusCode).toBe(200);
});

test('I-7 24시간 30회: 성공이 끼어도 24시간 누적은 남고, 30번째 실패에 24시간 잠김(daily), CLI mfa-unlock 뒤 해제', async () => {
  const a = await adminIn('enrolled');
  // 15분 창 밖의 실패 25회(그중 일부는 성공으로 풀린 것)
  await q(`insert into auth.rate_events (bucket, key, created_at) select case when g % 2 = 0 then 'mfa-fail' else 'mfa-fail-released' end, $1, now() - interval '2 hours' from generate_series(1, 25) g`, [a.id]);
  // 실패 4회 → 성공(15분 창 해제) → 실패
  const wrong = codeAt(a.secret!, 5);
  let ch = await challengeFor(a.email);
  for (let i = 0; i < 4; i++) await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: wrong });
  expect((await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: codeAt(a.secret!) })).statusCode).toBe(200);
  expect(await q("select 1 from auth.rate_events where key = $1 and bucket = 'mfa-fail' and created_at > now() - interval '15 minutes'", [a.id])).toHaveLength(0);
  expect((await q("select count(*)::int n from auth.rate_events where key = $1 and bucket in ('mfa-fail', 'mfa-fail-released')", [a.id]))[0].n).toBe(29);
  ch = await challengeFor(a.email);
  const r = await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: wrong });
  expect(r.statusCode).toBe(429);
  expect(r.json().error).toMatchObject({ message: 'mfa_locked', lockScope: 'daily' });
  expect(r.json().error.retryAfterMinutes).toBeGreaterThan(60 * 21);
  expect((await logsOf(ctx, a.id)).filter((l) => l.action === '2단계인증잠김').at(-1)!.detail).toMatch(/^limit=daily/);
  // 잠금 해제(CLI와 같은 동작: 두 bucket 삭제)는 admin-mfa-admin.test.ts의 CLI 테스트에서 고정한다
  await q("delete from auth.rate_events where key = $1 and bucket in ('mfa-fail', 'mfa-fail-released')", [a.id]);
  await clearLastStep(ctx, a.id);
  expect((await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: await challengeFor(a.email), code: codeAt(a.secret!) })).statusCode).toBe(200);
});

test('IP 한도: 같은 IP(/64) 50회/15분 뒤 429 rate_limited', async () => {
  const a = await adminIn('enrolled');
  const ch = await challengeFor(a.email);
  await q("insert into auth.rate_events (bucket, key) select 'mfa-ip', '2001:db8:1:2::/64' from generate_series(1, 50)");
  const r = await apps.enforce.call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: '000000' }, { 'x-bara-client-ip': '2001:db8:1:2:aaaa::1' });
  expect(r.statusCode).toBe(429);
  expect(r.json().error).toMatchObject({ code: 'rate_limited', message: 'rate_limited' });
  expect(r.json().error.lockScope).toBeUndefined();
});

// ---- 2.3 guard, 4.9

async function passwordOnlySession(userId: string, opts: { days?: number } = {}) {
  const token = `pre-${Math.random().toString(36).slice(2)}-${'x'.repeat(20)}`;
  await q(`insert into auth.sessions (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3::int))`, [createHash('sha256').update(token).digest('hex'), userId, opts.days ?? 30]);
  return token;
}

test('guard: 도입 전 30일 세션(mfa_at 없음)은 enforce에서 죽고 행이 지워진다. optional은 이력 없는 계정만, off는 산다', async () => {
  const fresh = await adminIn('fresh');
  const enrolled = await adminIn('enrolled');
  const ticket = await adminIn('ticket');
  const cases: Array<[MfaMode, typeof fresh, number]> = [
    ['enforce', fresh, 401], ['enforce', enrolled, 401], ['enforce', ticket, 401],
    ['optional', fresh, 200], ['optional', enrolled, 401], ['optional', ticket, 401],
    ['off', fresh, 200], ['off', enrolled, 200], ['off', ticket, 200],
  ];
  for (const [mode, a, status] of cases) {
    const t = await passwordOnlySession(a.id);
    const r = await sessionGet(mode, t);
    expect(r.statusCode, `${mode} ${status}`).toBe(status);
    if (status === 401) {
      expect(r.json().error.reason).toBeUndefined();
      expect(await q('select 1 from auth.sessions where token_hash = $1', [createHash('sha256').update(t).digest('hex')])).toHaveLength(0);
    } else {
      expect(r.json().renewed).toBe(false);
      expect(new Date(r.json().expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(12 * 3_600_000);
    }
    // 관리자 권한이 필요한 API도 같은 판정
    const admin = await apps[mode].call('GET', '/v1/admin/users/confirmations', undefined, { 'x-bara-session': t });
    expect(admin.statusCode).toBe(status === 401 ? 401 : 200);
  }
});

test('guard: 로그인해 있는 동안 관리자로 승격된 계정의 30일 세션은 관리자 권한을 얻지 못한다(쿼리 API·ops 포함)', async () => {
  const u = await addUser(ctx);
  const t = (await login('enforce', u.email)).json().sessionToken;
  expect((await sessionGet('enforce', t)).statusCode).toBe(200);
  await setRole(ctx, u.id, 'admin');
  await q("insert into admin_access_logs (admin_id, target_user_id, action, detail) values ($1, $1, '조회', 'x')", [u.id]);
  const q1 = await apps.enforce.call('POST', '/v1/query', { table: 'admin_access_logs', action: 'select', select: 'id' }, { 'x-bara-session': t });
  expect(q1.statusCode).toBe(200);
  expect(q1.json().data).toEqual([]); // anon: RLS로 접속 기록이 보이지 않는다
  expect((await sessionGet('enforce', t)).statusCode).toBe(401);
});

test('guard: 가입 마무리(signup-link/complete)로 생긴 관리자 세션은 관리자 권한이 없다', async () => {
  const email = `sl-${Date.now()}@bara-edu.kr`;
  await apps.enforce.call('POST', '/v1/auth/signup', { email, password: 'rightpass1', name: '홍길동', origin: 'https://bara-edu.kr' });
  const link = apps.enforce.mailer.sent.at(-1)!.link!;
  const token = new URL(link).searchParams.get('token')!;
  const [{ id }] = await q('select id from auth.users where email = $1', [email]);
  await setRole(ctx, id, 'admin');
  const r = await apps.enforce.call('POST', '/v1/auth/signup-link/complete', { token, password: 'rightpass1' });
  expect(r.statusCode).toBe(200);
  const s = r.json().sessionToken;
  const [row] = await q('select expires_at - created_at as ttl, mfa_at from auth.sessions where user_id = $1', [id]);
  expect(row.ttl.hours).toBe(12);
  expect(row.mfa_at).toBeNull();
  expect((await sessionGet('enforce', s)).statusCode).toBe(401);
});

for (const mode of ['off', 'optional', 'enforce'] as const) {
  test(`guard 수명(${mode}): 12시간이면 401 reason=max, 1시간 미사용이면 reason=idle, 둘 다면 max, 이유는 한 번만`, async () => {
    const a = await adminIn('enrolled');
    const mk = async () => mfaSession(ctx, a.id);
    const t1 = await mk();
    await q("update auth.sessions set created_at = now() - interval '12 hours 1 second' where token_hash = $1", [createHash('sha256').update(t1).digest('hex')]);
    const r1 = await sessionGet(mode, t1);
    expect(r1.statusCode).toBe(401);
    expect(r1.json().error).toEqual({ code: 'unauthenticated', message: 'session_expired', reason: 'max' });
    expect((await sessionGet(mode, t1)).json().error.reason).toBeUndefined();
    const t2 = await mk();
    await q("update auth.sessions set last_seen_at = now() - interval '61 minutes' where token_hash = $1", [createHash('sha256').update(t2).digest('hex')]);
    expect((await sessionGet(mode, t2)).json().error).toMatchObject({ message: 'session_expired', reason: 'idle' });
    const t3 = await mk();
    await q("update auth.sessions set created_at = now() - interval '13 hours', last_seen_at = now() - interval '2 hours' where token_hash = $1", [createHash('sha256').update(t3).digest('hex')]);
    expect((await sessionGet(mode, t3)).json().error.reason).toBe('max');
  });
}

test('guard "사용": 프리페치·/my·공개 요청·쿼리 읽기는 last_seen_at을 늘리지 않고, x-bara-activity·관리자 API·쿼리 쓰기는 늘린다(1분 묶음)', async () => {
  const a = await adminIn('enrolled');
  const t = await mfaSession(ctx, a.id);
  const h = createHash('sha256').update(t).digest('hex');
  const set = () => q("update auth.sessions set last_seen_at = now() - interval '30 minutes' where token_hash = $1", [h]);
  const age = async () => Number((await q('select extract(epoch from now() - last_seen_at)::int as s from auth.sessions where token_hash = $1', [h]))[0].s);
  await set();
  await sessionGet('enforce', t);
  expect(await age()).toBeGreaterThan(1700);
  await sessionGet('enforce', t, { 'x-bara-activity': 'admin', 'next-router-prefetch': '1' });
  await sessionGet('enforce', t, { 'x-bara-activity': 'admin', 'sec-purpose': 'prefetch' });
  await apps.enforce.call('POST', '/v1/query', { table: 'courses', action: 'select', select: 'id' }, { 'x-bara-session': t });
  expect(await age()).toBeGreaterThan(1700);
  await sessionGet('enforce', t, { 'x-bara-activity': 'admin' });
  expect(await age()).toBeLessThan(5);
  await set();
  await apps.enforce.call('GET', '/v1/admin/users/confirmations', undefined, { 'x-bara-session': t });
  expect(await age()).toBeLessThan(5);
  await set();
  await apps.enforce.call('POST', '/v1/query', { table: 'categories', action: 'insert', values: { name: `c-${Date.now()}` } }, { 'x-bara-session': t });
  expect(await age()).toBeLessThan(5);
  // 관리자 세션은 슬라이딩하지 않는다
  const before = (await q('select expires_at from auth.sessions where token_hash = $1', [h]))[0].expires_at.getTime();
  const r = await sessionGet('enforce', t, { 'x-bara-activity': 'admin' });
  expect(r.json().renewed).toBe(false);
  expect((await q('select expires_at from auth.sessions where token_hash = $1', [h]))[0].expires_at.getTime()).toBe(before);
});

test('learner 세션은 바뀌지 않는다: 12시간·1시간 규칙 없음, 슬라이딩 유지', async () => {
  const l = await addUser(ctx);
  const t = (await login('enforce', l.email)).json().sessionToken;
  const h = createHash('sha256').update(t).digest('hex');
  await q("update auth.sessions set created_at = now() - interval '20 days', last_seen_at = now() - interval '5 days', expires_at = now() + interval '10 days' where token_hash = $1", [h]);
  const r = await sessionGet('enforce', t);
  expect(r.statusCode).toBe(200);
  expect(r.json().renewed).toBe(true);
});
