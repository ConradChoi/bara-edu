import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { setupTestDb } from './helpers/db.js';
import { addUser, caller, clearLastStep, codeAt, codeFromB32, enrollDirect, logsOf, mailsTo, mfaApp, mfaSession, PASSWORD, RING_V1 } from './helpers/mfa.js';
import { withService } from '../src/db/context.js';
import { issueEnrollTicketIn } from '../src/auth/mfa.js';
import type { MemoryMailer } from '../src/mail/mailer.js';
import type { MfaMode } from '../src/config.js';

// 등록(4.4 입구 A·B·C), 로그인 후 API(4.5).
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
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const call = (...args: Parameters<ReturnType<typeof caller>>) => apps.enforce.call(...args);
const S = (token: string) => ({ 'x-bara-session': token });

async function ticketAdmin() {
  const a = await addUser(ctx, { admin: true });
  const t = await withService(ctx.pool, async (tx) => {
    await tx.query('insert into auth.mfa_account_state (user_id, ticket_required_at) values ($1, now())', [a.id]);
    return issueEnrollTicketIn(tx, RING_V1, a.id, null);
  });
  const ch = (await call('POST', '/v1/auth/login', { email: a.email, password: PASSWORD })).json();
  expect(ch.mfa).toBe('enroll_required');
  return { ...a, ticket: t.code, challenge: ch.challengeToken as string };
}

async function enrolledAdmin() {
  const a = await addUser(ctx, { admin: true });
  const secret = await enrollDirect(ctx, RING_V1, a.id);
  return { ...a, secret };
}

// ---- 입구 B

test('입구 B 전체: 등록 코드 → QR(새로고침은 같은 것, renew는 새 것) → 확인 → 세션·복구 코드·기록·알림', async () => {
  const a = await ticketAdmin();
  const bad = await call('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: a.challenge, enrollTicket: a.ticket === '00000000' ? '11111111' : '00000000' });
  expect(bad.statusCode).toBe(403);
  expect(bad.json().error).toMatchObject({ message: 'ticket_invalid', attemptsLeft: 4 });
  const ok = await call('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: a.challenge, enrollTicket: `${a.ticket.slice(0, 4)} ${a.ticket.slice(4)}` });
  expect(ok.statusCode).toBe(200);
  expect(ok.json()).toEqual({ ok: true });
  expect(ok.headers['cache-control']).toBe('no-store');

  const s1 = await call('POST', '/v1/auth/mfa/enroll/start', { challengeToken: a.challenge });
  expect(s1.statusCode).toBe(200);
  const e1 = s1.json();
  expect(e1.entry).toBe('B');
  expect(e1.secretBase32).toMatch(/^[A-Z2-7]{32}$/);
  expect(e1.otpauthUri).toContain(`secret=${e1.secretBase32}`);
  expect(e1.otpauthUri).toContain(encodeURIComponent(a.email));
  const mins = (new Date(e1.expiresAt).getTime() - Date.now()) / 60_000;
  expect(mins).toBeGreaterThan(9.9);
  expect(mins).toBeLessThanOrEqual(10);
  const [row] = await q('select secret_ciphertext, key_version from auth.mfa_enrollments where id = $1', [e1.enrollmentId]);
  expect(row.key_version).toBe(1);
  expect(row.secret_ciphertext.toString('latin1')).not.toContain(e1.secretBase32);

  expect((await call('POST', '/v1/auth/mfa/enroll/current', { challengeToken: a.challenge })).json()).toEqual(e1);
  expect((await call('POST', '/v1/auth/mfa/enroll/start', { challengeToken: a.challenge })).json()).toEqual(e1);
  const e2 = (await call('POST', '/v1/auth/mfa/enroll/start', { challengeToken: a.challenge, renew: true })).json();
  expect(e2.enrollmentId).not.toBe(e1.enrollmentId);
  expect(e2.secretBase32).not.toBe(e1.secretBase32);
  expect(await q('select 1 from auth.mfa_enrollments where user_id = $1', [a.id])).toHaveLength(1);

  const wrong = await call('POST', '/v1/auth/mfa/enroll/confirm', { challengeToken: a.challenge, enrollmentId: e2.enrollmentId, code: codeFromB32(e1.secretBase32) });
  expect(wrong.json().error).toMatchObject({ message: 'wrong_code', attemptsLeft: 4 });
  const c = await call('POST', '/v1/auth/mfa/enroll/confirm', { challengeToken: a.challenge, enrollmentId: e2.enrollmentId, code: codeFromB32(e2.secretBase32) }, { 'x-bara-client-ip': '203.0.113.44' });
  expect(c.statusCode).toBe(200);
  const b = c.json();
  expect(b.recoveryCodes).toHaveLength(10);
  expect(Object.keys(b).sort()).toEqual(['expiresAt', 'recoveryCodes', 'sessionToken', 'userId']);
  const [s] = await q('select mfa_method, expires_at - created_at as ttl from auth.sessions where token_hash = $1', [sha(b.sessionToken)]);
  expect(s.mfa_method).toBe('enroll');
  expect(s.ttl.hours).toBe(12);
  const [f] = await q('select enrolled_via, host(enrolled_ip) as ip, key_version from auth.mfa_factors where user_id = $1', [a.id]);
  expect(f).toEqual({ enrolled_via: 'ticket', ip: '203.0.113.44', key_version: 1 });
  expect((await q('select used_at is not null as used from auth.mfa_enroll_tickets where user_id = $1', [a.id]))[0].used).toBe(true);
  expect((await q('select used_at is not null as used from auth.mfa_challenges where token_hash = $1', [sha(a.challenge)]))[0].used).toBe(true);
  expect(await q('select 1 from auth.mfa_enrollments where user_id = $1', [a.id])).toHaveLength(0);
  expect((await q('select ever_enrolled_at is not null as e, ticket_required_at is not null as t, recovery_codes_issued_at is not null as i from auth.mfa_account_state where user_id = $1', [a.id]))[0]).toEqual({ e: true, t: true, i: true });
  const logs = await logsOf(ctx, a.id);
  expect(logs.map((l) => [l.action, l.detail.replace(/;alert=self_only$/, '')]).sort()).toEqual([['2단계인증등록', 'via=ticket'], ['로그인', 'mfa=enroll']]);
  expect(mailsTo(apps.enforce.mailer, a.email).map((m) => m.template)).toEqual(['mfa_enrolled']);
  // 같은 번호로 다음 로그인은 재사용
  const ch = (await call('POST', '/v1/auth/login', { email: a.email, password: PASSWORD })).json().challengeToken;
  expect((await call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: codeFromB32(e2.secretBase32) })).json().error.message).toBe('code_reused');
  // 보관 확인
  const status1 = (await call('GET', '/v1/auth/mfa/status', undefined, S(b.sessionToken))).json();
  expect(status1).toMatchObject({ enrolled: true, recoveryCodesLeft: 10, recoveryCodesAcked: false, mode: 'enforce', graceUntil: null, canSelfEnroll: false, signedInWithRecovery: false });
  expect((await call('POST', '/v1/auth/mfa/recovery-codes/ack', {}, S(b.sessionToken))).json()).toEqual({ ok: true });
  expect((await call('GET', '/v1/auth/mfa/status', undefined, S(b.sessionToken))).json().recoveryCodesAcked).toBe(true);
});

test('입구 B: 등록 코드 확인 없이 start → 403 ticket_not_verified, 코드 없음·만료·5회 실패 → 409 ticket_unusable', async () => {
  const a = await ticketAdmin();
  expect((await call('POST', '/v1/auth/mfa/enroll/start', { challengeToken: a.challenge })).json().error).toMatchObject({ code: 'forbidden', message: 'ticket_not_verified' });
  const wrong = a.ticket === '12345678' ? '87654321' : '12345678';
  for (let i = 4; i >= 1; i--) expect((await call('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: a.challenge, enrollTicket: wrong })).json().error.attemptsLeft).toBe(i);
  const fifth = await call('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: a.challenge, enrollTicket: wrong });
  expect(fifth.statusCode).toBe(409);
  expect(fifth.json().error.message).toBe('ticket_unusable');
  expect((await call('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: a.challenge, enrollTicket: a.ticket })).json().error.message).toBe('ticket_unusable');

  const b = await ticketAdmin();
  await q("update auth.mfa_enroll_tickets set expires_at = now() - interval '1 second' where user_id = $1", [b.id]);
  expect((await call('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: b.challenge, enrollTicket: b.ticket })).json().error.message).toBe('ticket_unusable');
  const c = await ticketAdmin();
  await q('delete from auth.mfa_enroll_tickets where user_id = $1', [c.id]);
  expect((await call('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: c.challenge, enrollTicket: c.ticket })).json().error.message).toBe('ticket_unusable');
  expect((await call('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: c.challenge, enrollTicket: '1234' })).json().error).toMatchObject({ code: 'validation', field: 'enrollTicket' });
});

test('등록 묶기(M-2): 다른 대기표·다른 사용자·다른 입구의 enrollmentId로 confirm → 404', async () => {
  const a = await ticketAdmin();
  const b = await ticketAdmin();
  for (const x of [a, b]) await call('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: x.challenge, enrollTicket: x.ticket });
  const ea = (await call('POST', '/v1/auth/mfa/enroll/start', { challengeToken: a.challenge })).json();
  const r1 = await call('POST', '/v1/auth/mfa/enroll/confirm', { challengeToken: b.challenge, enrollmentId: ea.enrollmentId, code: codeFromB32(ea.secretBase32) });
  expect(r1.statusCode).toBe(404);
  // 같은 사용자라도 세션 경로로는 B의 등록 대기를 확정할 수 없다
  const sess = await mfaSession(ctx, a.id);
  expect((await call('POST', '/v1/auth/mfa/enroll/confirm', { enrollmentId: ea.enrollmentId, code: codeFromB32(ea.secretBase32) }, S(sess))).statusCode).toBe(404);
  // 다른 관리자의 세션
  const other = await enrolledAdmin();
  expect((await call('POST', '/v1/auth/mfa/enroll/confirm', { enrollmentId: ea.enrollmentId, code: codeFromB32(ea.secretBase32) }, S(await mfaSession(ctx, other.id)))).statusCode).toBe(404);
  expect(await q('select 1 from auth.mfa_factors where user_id = $1', [a.id])).toHaveLength(0);
});

test('confirm 롤백: 접속 기록 insert가 실패하면 503 log_failed, 등록 코드는 쓰지 않은 상태로 남고 등록·세션이 없다', async () => {
  const a = await ticketAdmin();
  await call('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: a.challenge, enrollTicket: a.ticket });
  const e = (await call('POST', '/v1/auth/mfa/enroll/start', { challengeToken: a.challenge })).json();
  await q("create or replace function public.test_fail_mfa_log() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$");
  await q('create trigger test_fail_mfa_log before insert on admin_access_logs for each row execute function public.test_fail_mfa_log()');
  try {
    const r = await call('POST', '/v1/auth/mfa/enroll/confirm', { challengeToken: a.challenge, enrollmentId: e.enrollmentId, code: codeFromB32(e.secretBase32) });
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toMatchObject({ code: 'unavailable', message: 'log_failed' });
  } finally {
    await q('drop trigger test_fail_mfa_log on admin_access_logs');
  }
  expect((await q('select used_at from auth.mfa_enroll_tickets where user_id = $1', [a.id]))[0].used_at).toBeNull();
  expect(await q('select 1 from auth.mfa_factors where user_id = $1', [a.id])).toHaveLength(0);
  expect(await q('select 1 from auth.sessions where user_id = $1', [a.id])).toHaveLength(0);
  expect(await q('select 1 from auth.mfa_enrollments where id = $1', [e.enrollmentId])).toHaveLength(1);
  expect(apps.enforce.mailer.sent).toHaveLength(0);
});

test('등록 대기: 5번 틀리면 409 enrollment_expired(삭제), 10분이 지나도 409, current는 404 no_enrollment + ticketVerified', async () => {
  const a = await ticketAdmin();
  await call('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: a.challenge, enrollTicket: a.ticket });
  const e = (await call('POST', '/v1/auth/mfa/enroll/start', { challengeToken: a.challenge })).json();
  const wrong = codeFromB32(e.secretBase32, 5);
  for (let i = 4; i >= 1; i--) expect((await call('POST', '/v1/auth/mfa/enroll/confirm', { challengeToken: a.challenge, enrollmentId: e.enrollmentId, code: wrong })).json().error.attemptsLeft).toBe(i);
  const r = await call('POST', '/v1/auth/mfa/enroll/confirm', { challengeToken: a.challenge, enrollmentId: e.enrollmentId, code: wrong });
  expect(r.statusCode).toBe(409);
  expect(r.json().error.message).toBe('enrollment_expired');
  const cur = await call('POST', '/v1/auth/mfa/enroll/current', { challengeToken: a.challenge });
  expect(cur.statusCode).toBe(404);
  expect(cur.json().error).toMatchObject({ code: 'not_found', message: 'no_enrollment', ticketVerified: true });
  const e2 = (await call('POST', '/v1/auth/mfa/enroll/start', { challengeToken: a.challenge })).json();
  await q("update auth.mfa_enrollments set expires_at = now() - interval '1 second' where id = $1", [e2.enrollmentId]);
  expect((await call('POST', '/v1/auth/mfa/enroll/confirm', { challengeToken: a.challenge, enrollmentId: e2.enrollmentId, code: codeFromB32(e2.secretBase32) })).json().error.message).toBe('enrollment_expired');
});

// ---- 입구 A

test('입구 A(optional): 비밀번호 세션 → 등록 확정 시 그 세션과 다른 세션을 지우고 새 12시간 세션(mfa enroll)', async () => {
  const a = await addUser(ctx, { admin: true });
  const login = () => apps.optional.call('POST', '/v1/auth/login', { email: a.email, password: PASSWORD });
  const old = (await login()).json().sessionToken;
  const other = (await login()).json().sessionToken;
  expect(old).toBeTruthy();
  const st = (await apps.optional.call('GET', '/v1/auth/mfa/status', undefined, S(old))).json();
  expect(st).toMatchObject({ mode: 'optional', enrolled: false, canSelfEnroll: true, graceUntil: '2026-12-03T00:00:00+09:00', recoveryCodesAcked: true });
  const e = (await apps.optional.call('POST', '/v1/auth/mfa/enroll/start', {}, S(old))).json();
  expect(e.entry).toBe('A');
  expect((await apps.optional.call('POST', '/v1/auth/mfa/enroll/start', {}, S(old))).json().enrollmentId).toBe(e.enrollmentId);
  expect((await apps.optional.call('POST', '/v1/auth/mfa/enroll/current', {}, S(old))).json().enrollmentId).toBe(e.enrollmentId);
  const c = await apps.optional.call('POST', '/v1/auth/mfa/enroll/confirm', { enrollmentId: e.enrollmentId, code: codeFromB32(e.secretBase32) }, S(old));
  expect(c.statusCode).toBe(200);
  const b = c.json();
  expect(b.recoveryCodes).toHaveLength(10);
  expect(b.sessionToken).not.toBe(old);
  expect((await apps.optional.call('GET', '/v1/auth/session', undefined, S(old))).statusCode).toBe(401);
  expect((await apps.optional.call('GET', '/v1/auth/session', undefined, S(other))).statusCode).toBe(401);
  const [s] = await q('select mfa_method, expires_at - created_at as ttl from auth.sessions where user_id = $1', [a.id]);
  expect(s.mfa_method).toBe('enroll');
  expect(s.ttl.hours).toBe(12);
  expect((await q('select enrolled_via from auth.mfa_factors where user_id = $1', [a.id]))[0].enrolled_via).toBe('session');
  expect((await logsOf(ctx, a.id)).map((l) => l.action).sort()).toEqual(['2단계인증등록', '로그인', '로그인', '로그인']);
  // 등록한 관리자는 다음 로그인부터 6자리
  expect((await login()).json().mfa).toBe('required');
});

test('입구 A 거절: 이미 등록됨 → 409 already_enrolled, 등록 코드가 필요한 계정 → 409 ticket_required, 학습자 → 403 not_admin, 세션 없음 → 401', async () => {
  const en = await enrolledAdmin();
  expect((await call('POST', '/v1/auth/mfa/enroll/start', {}, S(await mfaSession(ctx, en.id)))).json().error).toMatchObject({ code: 'conflict', message: 'already_enrolled' });
  const t = await addUser(ctx, { admin: true });
  await q('insert into auth.mfa_account_state (user_id, ticket_required_at) values ($1, now())', [t.id]);
  expect((await apps.off.call('POST', '/v1/auth/mfa/enroll/start', {}, S(await mfaSession(ctx, t.id)))).json().error).toMatchObject({ code: 'conflict', message: 'ticket_required' });
  const l = await addUser(ctx);
  const lt = await mfaSession(ctx, l.id);
  for (const [m, u] of [['POST', '/v1/auth/mfa/enroll/start'], ['POST', '/v1/auth/mfa/enroll/current'], ['GET', '/v1/auth/mfa/status'], ['POST', '/v1/auth/mfa/recovery-codes/ack']] as const) {
    expect((await call(m, u, m === 'POST' ? {} : undefined, S(lt))).json().error.message, u).toBe('not_admin');
  }
  expect((await call('POST', '/v1/auth/mfa/enroll/start', {})).statusCode).toBe(401);
});

// ---- 입구 C

test('I-4 입구 C: 세션만으로는 인증 앱을 바꿀 수 없다(재확인 필수), 6자리 재사용·오답은 mfa-fail로 센다', async () => {
  const a = await enrolledAdmin();
  const s = await mfaSession(ctx, a.id);
  expect((await call('POST', '/v1/auth/mfa/enroll/start', {}, S(s))).json().error.message).toBe('already_enrolled');
  expect((await call('POST', '/v1/auth/mfa/enroll/start', { currentCode: '123456', recoveryCode: 'ABCDE-FGHJK' }, S(s))).json().error).toMatchObject({ code: 'validation', field: 'currentCode' });
  expect((await call('POST', '/v1/auth/mfa/enroll/start', { currentCode: '12' }, S(s))).json().error).toMatchObject({ field: 'currentCode' });
  const wrong = await call('POST', '/v1/auth/mfa/enroll/start', { currentCode: codeAt(a.secret, 5) }, S(s));
  expect(wrong.statusCode).toBe(403);
  expect(wrong.json().error.message).toBe('wrong_code');
  expect(await q("select 1 from auth.rate_events where key = $1 and bucket = 'mfa-fail'", [a.id])).toHaveLength(1);
  const ok = await call('POST', '/v1/auth/mfa/enroll/start', { currentCode: codeAt(a.secret) }, S(s));
  expect(ok.json().entry).toBe('C');
  expect((await call('POST', '/v1/auth/mfa/enroll/start', { currentCode: codeAt(a.secret) }, S(s))).json().error.message).toBe('code_reused');
  // 새로고침은 재확인 없이 같은 등록 대기
  expect((await call('POST', '/v1/auth/mfa/enroll/current', {}, S(s))).json().enrollmentId).toBe(ok.json().enrollmentId);
  // 미등록 계정이 코드를 내면 not_enrolled
  const fresh = await addUser(ctx, { admin: true });
  expect((await call('POST', '/v1/auth/mfa/enroll/start', { currentCode: '123456' }, S(await mfaSession(ctx, fresh.id)))).json().error.message).toBe('not_enrolled');
});

test('입구 C(복구 코드로 재확인): 코드는 그 자리에서 소모, 알림, 확정하면 옛 등록 교체·다른 세션 삭제·지금 세션 유지, rotate=false면 복구 코드 그대로', async () => {
  const a = await enrolledAdmin();
  const s = await mfaSession(ctx, a.id, 'recovery');
  const other = await mfaSession(ctx, a.id);
  await clearLastStep(ctx, a.id);
  const codes = (await call('POST', '/v1/auth/mfa/recovery-codes', { code: codeAt(a.secret) }, S(other))).json().recoveryCodes as string[];
  apps.enforce.mailer.sent.length = 0;
  const st = await call('POST', '/v1/auth/mfa/enroll/start', { recoveryCode: codes[0] }, S(s));
  expect(st.json().entry).toBe('C');
  expect((await q('select count(*)::int n from auth.mfa_recovery_codes where user_id = $1 and used_at is null', [a.id]))[0].n).toBe(9);
  expect(mailsTo(apps.enforce.mailer, a.email).map((m) => m.template)).toEqual(['mfa_recovery_used']);
  expect((await call('POST', '/v1/auth/mfa/enroll/start', { recoveryCode: codes[0] }, S(s))).json().error.message).toBe('wrong_code');
  const e = st.json();
  const c = await call('POST', '/v1/auth/mfa/enroll/confirm', { enrollmentId: e.enrollmentId, code: codeFromB32(e.secretBase32), rotateRecoveryCodes: false }, S(s));
  expect(c.statusCode).toBe(200);
  expect(c.json()).toEqual({ recoveryCodes: null });
  expect((await call('GET', '/v1/auth/session', undefined, S(s))).statusCode).toBe(200);
  expect((await call('GET', '/v1/auth/session', undefined, S(other))).statusCode).toBe(401);
  expect((await q('select count(*)::int n from auth.mfa_recovery_codes where user_id = $1 and used_at is null', [a.id]))[0].n).toBe(9);
  const [f] = await q('select enrolled_via from auth.mfa_factors where user_id = $1', [a.id]);
  expect(f.enrolled_via).toBe('replace');
  expect((await logsOf(ctx, a.id)).at(-1)).toMatchObject({ action: '2단계인증등록', detail: expect.stringMatching(/^via=replace;check=recovery/) });
  // 옛 인증 앱 번호는 더 이상 맞지 않는다
  const ch = (await call('POST', '/v1/auth/login', { email: a.email, password: PASSWORD })).json().challengeToken;
  expect((await call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: codeAt(a.secret, 1) })).json().error.message).toBe('wrong_code');
});

test('입구 C(6자리) + rotate: 새 복구 코드 10개, 기록 복구코드재발급 via=replace', async () => {
  const a = await enrolledAdmin();
  const s = await mfaSession(ctx, a.id);
  const e = (await call('POST', '/v1/auth/mfa/enroll/start', { currentCode: codeAt(a.secret) }, S(s))).json();
  const c = await call('POST', '/v1/auth/mfa/enroll/confirm', { enrollmentId: e.enrollmentId, code: codeFromB32(e.secretBase32), rotateRecoveryCodes: true }, S(s));
  expect(c.json().recoveryCodes).toHaveLength(10);
  expect(c.json().sessionToken).toBeUndefined();
  // 같은 트랜잭션의 두 행은 created_at이 같고 id가 uuid라 순서를 보지 않는다
  expect((await logsOf(ctx, a.id)).map((l) => [l.action, l.detail.replace(/;alert=self_only$/, '')]).sort()).toEqual([
    ['2단계인증등록', 'via=replace;check=totp'],
    ['복구코드재발급', 'count=10;via=replace'],
  ].sort());
});

test('m-1 입구 C 등록 대기는 시작한 세션에만 묶인다: 다른 세션은 다시 읽기·확정 불가, 시작한 세션이 지워지면 대기도 지워진다', async () => {
  const a = await enrolledAdmin();
  const s = await mfaSession(ctx, a.id);
  const other = await mfaSession(ctx, a.id);
  const e = (await call('POST', '/v1/auth/mfa/enroll/start', { currentCode: codeAt(a.secret) }, S(s))).json();
  expect(e.entry).toBe('C');
  expect((await q('select session_hash from auth.mfa_enrollments where id = $1', [e.enrollmentId]))[0].session_hash).toBe(sha(s));
  // 시작한 세션은 다시 읽을 수 있다
  const mine = await call('POST', '/v1/auth/mfa/enroll/current', {}, S(s));
  expect(mine.statusCode).toBe(200);
  expect(mine.json().secretBase32).toBe(e.secretBase32);
  // 다른 세션은 없는 것으로 본다(비밀 키 없음)
  const peek = await call('POST', '/v1/auth/mfa/enroll/current', {}, S(other));
  expect(peek.statusCode).toBe(404);
  expect(peek.body).not.toContain(e.secretBase32);
  const steal = await call('POST', '/v1/auth/mfa/enroll/confirm', { enrollmentId: e.enrollmentId, code: codeFromB32(e.secretBase32), rotateRecoveryCodes: false }, S(other));
  expect(steal.statusCode).toBe(404);
  expect((await q('select enrolled_via from auth.mfa_factors where user_id = $1', [a.id]))[0].enrolled_via).not.toBe('replace');
  // 시작한 세션이 지워지면(로그아웃) 대기도 사라진다
  await q('delete from auth.sessions where token_hash = $1', [sha(s)]);
  expect((await q('select count(*)::int n from auth.mfa_enrollments where id = $1', [e.enrollmentId]))[0].n).toBe(0);
});

// ---- 4.5

test('복구 코드 재발급: 6자리 재확인, 오답은 mfa-fail, 재사용은 code_reused, 미등록은 409, 성공하면 옛 코드 무효·기록', async () => {
  const a = await enrolledAdmin();
  const s = await mfaSession(ctx, a.id);
  const r1 = await call('POST', '/v1/auth/mfa/recovery-codes', { code: codeAt(a.secret) }, S(s));
  const old = r1.json().recoveryCodes as string[];
  expect((await call('POST', '/v1/auth/mfa/recovery-codes', { code: codeAt(a.secret) }, S(s))).json().error.message).toBe('code_reused');
  expect((await call('POST', '/v1/auth/mfa/recovery-codes', { code: codeAt(a.secret, -4) }, S(s))).json().error.message).toBe('wrong_code');
  expect(await q("select 1 from auth.rate_events where key = $1 and bucket = 'mfa-fail'", [a.id])).toHaveLength(1);
  await clearLastStep(ctx, a.id);
  const fresh = (await call('POST', '/v1/auth/mfa/recovery-codes', { code: codeAt(a.secret) }, S(s))).json().recoveryCodes as string[];
  expect(fresh.some((c) => old.includes(c))).toBe(false);
  const ch = (await call('POST', '/v1/auth/login', { email: a.email, password: PASSWORD })).json().challengeToken;
  expect((await call('POST', '/v1/auth/mfa/recover', { challengeToken: ch, recoveryCode: old[0] })).json().error.message).toBe('wrong_code');
  expect((await logsOf(ctx, a.id)).filter((l) => l.action === '복구코드재발급').map((l) => l.detail)).toEqual(['count=10', 'count=10']);
  expect(apps.enforce.mailer.sent.filter((m) => m.to === a.email && m.template !== 'mfa_locked')).toHaveLength(0); // 재발급 메일 없음(1.3 D7)
  const un = await addUser(ctx, { admin: true });
  expect((await call('POST', '/v1/auth/mfa/recovery-codes', { code: '123456' }, S(await mfaSession(ctx, un.id)))).json().error).toMatchObject({ code: 'conflict', message: 'not_enrolled' });
});

test('status: 복구 코드로 로그인한 세션은 signedInWithRecovery, 세션 만료 시각, off 모드 표시', async () => {
  const a = await enrolledAdmin();
  const s = await mfaSession(ctx, a.id, 'recovery');
  const st = (await apps.off.call('GET', '/v1/auth/mfa/status', undefined, S(s))).json();
  expect(st).toMatchObject({ mode: 'off', enrolled: true, signedInWithRecovery: true, recoveryCodesLeft: 0, graceUntil: null });
  expect(typeof st.enrolledAt).toBe('string');
  expect(new Date(st.sessionExpiresAt).getTime() - Date.now()).toBeLessThanOrEqual(12 * 3_600_000);
  expect(Object.keys(st).sort()).toEqual(['canSelfEnroll', 'enrolled', 'enrolledAt', 'graceUntil', 'lastUsedAt', 'mode', 'recoveryCodesAcked', 'recoveryCodesLeft', 'sessionExpiresAt', 'signedInWithRecovery']);
});
