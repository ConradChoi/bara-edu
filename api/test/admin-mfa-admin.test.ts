import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { setupTestDb } from './helpers/db.js';
import { addUser, caller, clearLastStep, codeAt, codeFromB32, enrollDirect, logsOf, mailsTo, MASTER_V1, MASTER_V2, mfaApp, mfaSession, PASSWORD, RING_V1, setRole } from './helpers/mfa.js';
import { withService } from '../src/db/context.js';
import { issueEnrollTicketIn } from '../src/auth/mfa.js';
import { planAlertsIn, selfOnlySuffix } from '../src/auth/mfa-alerts.js';
import { applyModeTransition, initMfa } from '../src/auth/mfa-mode.js';
import { makeKeyring, MfaKeyError, verifyKeyCheckIn, type MfaKeyring } from '../src/auth/mfa-crypto.js';
import { createSession } from '../src/auth/sessions.js';
import { issueEmailToken } from '../src/auth/tokens.js';
import { MemoryMailer, type MailMessage } from '../src/mail/mailer.js';
import { SesMailer } from '../src/mail/ses.js';
import { KEY_MISMATCH_MESSAGE, runCli, TICKET_WARNING, type CliDeps } from '../scripts/admin-mfa.js';
import type { MfaMode } from '../src/config.js';
import type pg from 'pg';

// 관리자 초기화(4.6), 보안 알림(2.13), 재설정(2.5), CLI(2.7.3), 키(2.6), 모드 전환(2.14), 로그(9.4).
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
const ALERT_TO = 'sec@bara-edu.kr';
const apps = {} as Record<MfaMode, { app: FastifyInstance; mailer: MemoryMailer; call: ReturnType<typeof caller> }>;

beforeAll(async () => {
  ctx = await setupTestDb();
  // API 시작(initMfa)이 만드는 v1 키 검증 행. 운영 명령은 이 행과 맞는 키로만 동작한다.
  await withService(ctx.pool, (tx) => verifyKeyCheckIn(tx, RING_V1));
  for (const mode of ['off', 'optional', 'enforce'] as const) {
    const a = mfaApp(ctx, { mode, alertTo: ALERT_TO, grace: '2026-12-03T00:00:00+09:00' });
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
const call = (...args: Parameters<ReturnType<typeof caller>>) => apps.enforce.call(...args);
const S = (token: string) => ({ 'x-bara-session': token });
const sent = () => apps.enforce.mailer.sent;

async function enrolledAdmin(name?: string) {
  const a = await addUser(ctx, { admin: true, ...(name ? { name } : {}) });
  const secret = await enrollDirect(ctx, RING_V1, a.id);
  return { ...a, secret };
}
async function challenge(email: string, app = apps.enforce) {
  return (await app.call('POST', '/v1/auth/login', { email, password: PASSWORD })).json() as { mfa: string; challengeToken: string; enrollReason?: string };
}
const reset = (token: string, targetId: string, body: Record<string, unknown>) =>
  call('POST', `/v1/admin/users/${targetId}/mfa-reset`, { reason: 'lost_phone', identityChecked: true, ...body }, S(token));

async function withFailingLog<T>(fn: () => Promise<T>): Promise<T> {
  await q("create or replace function public.test_fail_mfa_log() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$");
  await q('create trigger test_fail_mfa_log before insert on admin_access_logs for each row execute function public.test_fail_mfa_log()');
  try {
    return await fn();
  } finally {
    await q('drop trigger test_fail_mfa_log on admin_access_logs');
  }
}

// 렌더링된 SES 본문
async function render(msg: MailMessage) {
  const out: SendEmailCommand['input'][] = [];
  await new SesMailer({ send: async (c: SendEmailCommand) => void out.push(c.input) } as never, 'no-reply@bara-edu.kr').send(msg);
  const s = out[0].Content!.Simple!;
  return { subject: s.Subject!.Data!, text: s.Body!.Text!.Data!, html: s.Body!.Html!.Data! };
}

// ---- 4.6.1 초기화

test('mfa-reset 성공: 대상의 등록·복구 코드·세션·대기표 삭제, 등록 코드 발급, ticket_required, 기록(메모 없음), 알림', async () => {
  const req = await enrolledAdmin();
  const target = await enrolledAdmin('대상관리자');
  const reqSession = await mfaSession(ctx, req.id);
  const targetSession = await mfaSession(ctx, target.id);
  await clearLastStep(ctx, target.id);
  await call('POST', '/v1/auth/mfa/recovery-codes', { code: codeAt(target.secret) }, S(targetSession));
  await challenge(target.email);
  sent().length = 0;

  const r = await reset(reqSession, target.id, { code: codeAt(req.secret), reason: 'other', memo: '휴대폰 분실 전화 확인' }, );
  expect(r.statusCode).toBe(200);
  expect(r.headers['cache-control']).toBe('no-store');
  const b = r.json();
  expect(Object.keys(b).sort()).toEqual(['enrollTicket', 'ok', 'ticketExpiresAt']);
  expect(b.enrollTicket).toMatch(/^\d{8}$/);
  const hours = (new Date(b.ticketExpiresAt).getTime() - Date.now()) / 3_600_000;
  expect(hours).toBeGreaterThan(23.9);
  expect(hours).toBeLessThanOrEqual(24);
  for (const t of ['mfa_factors', 'mfa_recovery_codes', 'mfa_challenges', 'sessions']) expect(await q(`select 1 from auth.${t} where user_id = $1`, [target.id]), t).toHaveLength(0);
  const [tk] = await q('select key_version, issued_by, used_at from auth.mfa_enroll_tickets where user_id = $1', [target.id]);
  expect(tk).toEqual({ key_version: 1, issued_by: req.id, used_at: null });
  expect((await q('select ticket_required_at is not null as t, reset_at is not null as r from auth.mfa_account_state where user_id = $1', [target.id]))[0]).toEqual({ t: true, r: true });
  const log = (await logsOf(ctx, target.id)).at(-1)!;
  expect(log).toMatchObject({ admin_id: req.id, action: '2단계인증초기화', detail: 'reason=other;by=admin' });
  expect(JSON.stringify(await q('select detail from admin_access_logs'))).not.toContain('휴대폰 분실');
  // 요청한 관리자의 세션은 그대로
  expect((await call('GET', '/v1/auth/session', undefined, S(reqSession))).statusCode).toBe(200);
  // 알림: 대상 본인 mfa_reset(by admin), 요청 관리자와 운영 주소에 경보
  expect(mailsTo(apps.enforce.mailer, target.email)).toEqual([expect.objectContaining({ template: 'mfa_reset', by: 'admin' })]);
  expect(mailsTo(apps.enforce.mailer, req.email)).toEqual([expect.objectContaining({ template: 'admin_security_alert', event: 'reset', ownerName: '대상관리자' })]);
  expect(mailsTo(apps.enforce.mailer, ALERT_TO)).toEqual([expect.objectContaining({ template: 'admin_security_alert', event: 'reset' })]);
  // 대상은 다음 로그인에서 등록 코드로 다시 등록
  const ch = await challenge(target.email);
  expect(ch).toMatchObject({ mfa: 'enroll_required', enrollReason: 'reset' });
  expect((await call('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: ch.challengeToken, enrollTicket: b.enrollTicket })).statusCode).toBe(200);
});

test('mfa-reset 거절: self_reset, not_found, target_not_admin, target_withdrawn, 학습자 403, 형식 400(field)', async () => {
  const req = await enrolledAdmin();
  const s = await mfaSession(ctx, req.id);
  const code = codeAt(req.secret, 5); // 번호 비교 전에 걸러지는 경우만(실패 횟수 안 셈)
  expect((await reset(s, req.id, { code })).json().error).toMatchObject({ code: 'conflict', message: 'self_reset' });
  expect((await reset(s, '00000000-0000-4000-8000-000000000000', { code })).statusCode).toBe(404);
  expect((await reset(s, 'not-a-uuid', { code })).statusCode).toBe(404);
  const learner = await addUser(ctx);
  expect((await reset(s, learner.id, { code })).json().error).toMatchObject({ code: 'conflict', message: 'target_not_admin' });
  const gone = await addUser(ctx, { admin: true });
  await q(`begin; set local session_replication_role = replica; update profiles set status = 'withdrawn' where id = '${gone.id}'; commit`);
  expect((await reset(s, gone.id, { code })).json().error).toMatchObject({ code: 'conflict', message: 'target_withdrawn' });
  expect(await q("select 1 from auth.rate_events where key = $1 and bucket = 'mfa-fail'", [req.id])).toHaveLength(0);
  const other = await enrolledAdmin();
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ code: '12' }, 'code'],
    [{ code: '123456', reason: 'boom' }, 'reason'],
    [{ code: '123456', reason: 'other' }, 'memo'],
    [{ code: '123456', reason: 'other', memo: '짧음' }, 'memo'],
    [{ code: '123456', memo: 'x'.repeat(201) }, 'memo'],
    [{ code: '123456', identityChecked: false }, 'identityChecked'],
  ];
  for (const [body, field] of bad) expect((await reset(s, other.id, body)).json().error, field).toMatchObject({ code: 'validation', field });
  expect((await reset(await mfaSession(ctx, learner.id), other.id, { code: '123456' })).statusCode).toBe(403);
  expect((await reset('nope', other.id, { code: '123456' })).statusCode).toBe(401);
});

test('mfa-reset: 2단계를 거치지 않은 관리자 세션은 off 모드에서도 403 mfa_session_required', async () => {
  const req = await enrolledAdmin();
  const target = await enrolledAdmin();
  const pw = (await createSession(ctx.pool as pg.Pool, req.id, 30)).token;
  const r = await apps.off.call('POST', `/v1/admin/users/${target.id}/mfa-reset`, { code: codeAt(req.secret), reason: 'lost_phone', identityChecked: true }, S(pw));
  expect(r.statusCode).toBe(403);
  expect(r.json().error.message).toBe('mfa_session_required');
  expect(await q('select 1 from auth.mfa_factors where user_id = $1', [target.id])).toHaveLength(1);
});

test('mfa-reset: 요청한 관리자의 오답은 mfa-fail로 세고(wrong_code), 이미 쓴 번호는 code_reused(안 셈)', async () => {
  const req = await enrolledAdmin();
  const s = await mfaSession(ctx, req.id);
  const [t1, t2] = [await enrolledAdmin(), await enrolledAdmin()];
  const w = await reset(s, t1.id, { code: codeAt(req.secret, 5) });
  expect(w.statusCode).toBe(403);
  expect(w.json().error.message).toBe('wrong_code');
  expect(await q("select 1 from auth.rate_events where key = $1 and bucket = 'mfa-fail'", [req.id])).toHaveLength(1);
  expect(await q('select 1 from auth.mfa_factors where user_id = $1', [t1.id])).toHaveLength(1);
  expect((await reset(s, t1.id, { code: codeAt(req.secret) })).statusCode).toBe(200);
  const again = await reset(s, t2.id, { code: codeAt(req.secret) });
  expect(again.json().error.message).toBe('code_reused');
  expect(await q("select 1 from auth.rate_events where key = $1 and bucket like 'mfa-fail%'", [req.id])).toHaveLength(1);
});

test('mfa-reset: 접속 기록이 실패하면 503 log_failed, 전체 롤백(대상 등록·세션 유지, 등록 코드 없음, 요청자 번호 미사용, 메일 없음)', async () => {
  const req = await enrolledAdmin();
  const target = await enrolledAdmin();
  const s = await mfaSession(ctx, req.id);
  const ts = await mfaSession(ctx, target.id);
  const r = await withFailingLog(() => reset(s, target.id, { code: codeAt(req.secret) }));
  expect(r.statusCode).toBe(503);
  expect(r.json().error).toMatchObject({ code: 'unavailable', message: 'log_failed' });
  expect(await q('select 1 from auth.mfa_factors where user_id = $1', [target.id])).toHaveLength(1);
  expect(await q('select 1 from auth.mfa_enroll_tickets where user_id = $1', [target.id])).toHaveLength(0);
  expect((await call('GET', '/v1/auth/session', undefined, S(ts))).statusCode).toBe(200);
  expect((await q('select last_used_step from auth.mfa_factors where user_id = $1', [req.id]))[0].last_used_step).toBe('0');
  expect(sent()).toHaveLength(0);
});

// ---- 4.6.2 조회

test('GET /v1/admin/users/:id/mfa: enrolled / not_enrolled / reset_pending, 관리자 아니면 404. overview는 활성 관리자 전원', async () => {
  const me = await enrolledAdmin();
  const s = await mfaSession(ctx, me.id);
  const fresh = await addUser(ctx, { admin: true });
  const pending = await addUser(ctx, { admin: true });
  await withService(ctx.pool, (tx) => issueEnrollTicketIn(tx, RING_V1, pending.id, me.id));
  const learner = await addUser(ctx);
  const get = (id: string) => call('GET', `/v1/admin/users/${id}/mfa`, undefined, S(s));
  const e = (await get(me.id)).json();
  expect(e).toMatchObject({ state: 'enrolled', ticketPendingUntil: null });
  expect(typeof e.enrolledAt).toBe('string');
  expect((await get(fresh.id)).json()).toEqual({ state: 'not_enrolled', enrolledAt: null, lastUsedAt: null, ticketPendingUntil: null });
  const p = (await get(pending.id)).json();
  expect(p.state).toBe('reset_pending');
  expect(new Date(p.ticketPendingUntil).getTime()).toBeGreaterThan(Date.now());
  expect((await get(learner.id)).statusCode).toBe(404);
  expect((await get(pending.id)).headers['cache-control']).toBe('no-store');
  // 만료된 등록 코드는 대기가 아니다
  await q("update auth.mfa_enroll_tickets set expires_at = now() - interval '1 second' where user_id = $1", [pending.id]);
  expect((await get(pending.id)).json().state).toBe('not_enrolled');
  const ov = (await call('GET', '/v1/admin/mfa/overview', undefined, S(s))).json();
  const byId = new Map(ov.items.map((i: { userId: string; state: string }) => [i.userId, i.state]));
  expect(byId.get(me.id)).toBe('enrolled');
  expect(byId.get(fresh.id)).toBe('not_enrolled');
  expect(byId.has(learner.id)).toBe(false);
  expect((await call('GET', '/v1/admin/mfa/overview', undefined, S(await mfaSession(ctx, learner.id)))).statusCode).toBe(403);
});

// ---- 2.13 보안 알림

test('I-6 보안 알림 5종: 본인 + 다른 활성 관리자 전원 + ADMIN_SECURITY_ALERT_TO, 본인 주소는 경보에서 빠진다', async () => {
  const watcher = await enrolledAdmin();
  const expectAlert = (owner: { email: string }, own: string, event: string) => {
    expect(mailsTo(apps.enforce.mailer, owner.email).map((m) => m.template), event).toContain(own);
    expect(mailsTo(apps.enforce.mailer, owner.email).some((m) => m.template === 'admin_security_alert'), event).toBe(false);
    for (const to of [watcher.email, ALERT_TO]) {
      expect(mailsTo(apps.enforce.mailer, to).filter((m) => m.template === 'admin_security_alert').map((m) => (m as { event: string }).event), `${event} ${to}`).toEqual([event]);
    }
    sent().length = 0;
  };
  // 1) 등록(입구 B)
  const a = await addUser(ctx, { admin: true });
  const t = await withService(ctx.pool, async (tx) => {
    await tx.query('insert into auth.mfa_account_state (user_id, ticket_required_at) values ($1, now())', [a.id]);
    return issueEnrollTicketIn(tx, RING_V1, a.id, null);
  });
  const ch = (await challenge(a.email)).challengeToken;
  await call('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: ch, enrollTicket: t.code });
  const e = (await call('POST', '/v1/auth/mfa/enroll/start', { challengeToken: ch })).json();
  const conf = (await call('POST', '/v1/auth/mfa/enroll/confirm', { challengeToken: ch, enrollmentId: e.enrollmentId, code: codeFromB32(e.secretBase32) })).json();
  expectAlert(a, 'mfa_enrolled', 'enrolled');
  // 2) 복구 코드 사용
  const r = await call('POST', '/v1/auth/mfa/recover', { challengeToken: (await challenge(a.email)).challengeToken, recoveryCode: conf.recoveryCodes[0] });
  expect(r.statusCode).toBe(200);
  expectAlert(a, 'mfa_recovery_used', 'recovery_used');
  expect(mailsTo(apps.enforce.mailer, a.email)).toHaveLength(0);
  // 3) 잠김(15분)
  await q("insert into auth.rate_events (bucket, key) select 'mfa-fail', $1 from generate_series(1, 9)", [a.id]);
  const lock = await call('POST', '/v1/auth/mfa/verify', { challengeToken: (await challenge(a.email)).challengeToken, code: '000000' });
  expect(lock.statusCode).toBe(429);
  expectAlert(a, 'mfa_locked', 'locked');
  // 4) 관리자 비밀번호 재설정(링크) — 2단계·실패 기록 유지, adminLine
  const token = await issueEmailToken(ctx.pool, a.id, 'recovery');
  expect((await call('POST', '/v1/auth/reset-password', { token, newPassword: 'brandnew123' })).statusCode).toBe(200);
  expect(mailsTo(apps.enforce.mailer, a.email)).toEqual([expect.objectContaining({ template: 'password_changed', adminLine: true })]);
  expectAlert(a, 'password_changed', 'password_reset');
  expect(await q('select 1 from auth.mfa_factors where user_id = $1', [a.id])).toHaveLength(1);
  expect((await q("select count(*)::int n from auth.rate_events where key = $1 and bucket = 'mfa-fail'", [a.id]))[0].n).toBe(10);
  expect((await logsOf(ctx, a.id)).at(-1)!.detail).not.toContain('alert=self_only');
  // 5) 초기화
  await q("delete from auth.rate_events where key = $1", [a.id]);
  await reset(await mfaSession(ctx, watcher.id), a.id, { code: codeAt(watcher.secret) });
  expect(mailsTo(apps.enforce.mailer, a.email).map((m) => m.template)).toEqual(['mfa_reset']);
  expect(mailsTo(apps.enforce.mailer, watcher.email).map((m) => (m as { event?: string }).event)).toEqual(['reset']); // 처리한 관리자도 받는다
  expect(mailsTo(apps.enforce.mailer, ALERT_TO)).toHaveLength(1);
});

test('I-6 다른 관리자·운영 주소가 없으면 본인 메일만, 접속 기록에 alert=self_only(별도 DB)', async () => {
  const solo = await setupTestDb();
  const a = mfaApp(solo, { mode: 'enforce' });
  try {
    await a.app.ready();
    const c = caller(a.app);
    const u = await addUser(solo, { admin: true });
    await enrollDirect(solo, RING_V1, u.id);
    await solo.adminPool.query("insert into auth.rate_events (bucket, key) select 'mfa-fail', $1 from generate_series(1, 9)", [u.id]);
    const ch = (await c('POST', '/v1/auth/login', { email: u.email, password: PASSWORD })).json().challengeToken;
    expect((await c('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: '000000' })).statusCode).toBe(429);
    expect(a.mailer.sent.map((m) => [m.to, m.template])).toEqual([[u.email, 'mfa_locked']]);
    expect((await logsOf(solo, u.id)).at(-1)).toMatchObject({ action: '2단계인증잠김', detail: 'limit=account;alert=self_only' });
    // 탈퇴 처리된 주소(@deleted.invalid)와 본인 주소는 수신자로 치지 않는다
    const client = await solo.adminPool.connect();
    try {
      await client.query('begin');
      const plan = await planAlertsIn(client as never, u.id, [u.email.toUpperCase().toLowerCase(), 'x@deleted.invalid'], { own: null, alert: 'locked', at: 't' });
      expect(plan).toEqual({ messages: [], selfOnly: true });
      expect(selfOnlySuffix(plan)).toBe(';alert=self_only');
    } finally {
      await client.query('rollback');
      client.release();
    }
  } finally {
    await a.app.close();
    await solo.close();
  }
});

test('mfa_locked 알림은 계정·한도마다 1시간에 1번, 접속 기록은 잠길 때마다', async () => {
  const a = await enrolledAdmin();
  for (let round = 0; round < 2; round++) {
    await q("delete from auth.rate_events where key = $1 and bucket = 'mfa-fail'", [a.id]);
    await q("insert into auth.rate_events (bucket, key) select 'mfa-fail', $1 from generate_series(1, 9)", [a.id]);
    expect((await call('POST', '/v1/auth/mfa/verify', { challengeToken: (await challenge(a.email)).challengeToken, code: '000000' })).statusCode).toBe(429);
  }
  expect(mailsTo(apps.enforce.mailer, a.email).map((m) => m.template)).toEqual(['mfa_locked']);
  expect(mailsTo(apps.enforce.mailer, ALERT_TO)).toHaveLength(1);
  expect((await logsOf(ctx, a.id)).filter((l) => l.action === '2단계인증잠김')).toHaveLength(2);
});

test('메일 본문(SES 렌더링): 링크·IP·비밀 값 없음, 문의처 블록 있음, 이름·시각·남은 개수 채움', async () => {
  const at = '2026년 11월 26일 오후 3시 5분';
  const msgs: MailMessage[] = [
    { to: 'a@bara-edu.kr', template: 'mfa_enrolled', at },
    { to: 'a@bara-edu.kr', template: 'mfa_reset', at, by: 'admin' },
    { to: 'a@bara-edu.kr', template: 'mfa_reset', at, by: 'db' },
    { to: 'a@bara-edu.kr', template: 'mfa_recovery_used', at, left: 3 },
    { to: 'a@bara-edu.kr', template: 'mfa_locked', at, scope: 'account', minutes: 15 },
    { to: 'a@bara-edu.kr', template: 'mfa_locked', at, scope: 'daily', minutes: 1440 },
    { to: 'a@bara-edu.kr', template: 'password_changed', at, adminLine: true },
    ...(['enrolled', 'reset', 'recovery_used', 'locked', 'locked_daily', 'password_reset'] as const).map(
      (event): MailMessage => ({ to: 'b@bara-edu.kr', template: 'admin_security_alert', at, ownerName: '홍길동', event, left: 3 }),
    ),
  ];
  for (const m of msgs) {
    const r = await render(m);
    const label = `${m.template}/${'event' in m ? m.event : 'scope' in m ? m.scope : 'by' in m ? m.by : ''}`;
    for (const body of [r.text, r.html]) {
      expect(body, label).not.toMatch(/https?:|:\/\/|www\.|<a /);
      expect(body, label).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
      expect(body, label).not.toMatch(/\{[a-zA-Z]+\}/); // 채우지 않은 자리
      expect(body, label).toContain('010-9025-5093');
      expect(body, label).toContain(at);
    }
    expect(r.subject, label).toMatch(/^\[바라 평생교육원\] /);
    if (m.template === 'admin_security_alert') expect(r.text, label).toContain('홍길동');
  }
  expect((await render(msgs[3])).text).toContain('3');
  expect((await render(msgs[6])).text).toContain('2단계 인증은 그대로예요');
  expect((await render({ to: 'a@bara-edu.kr', template: 'password_changed', at })).text).not.toContain('2단계 인증');
  expect((await render(msgs[1])).text).not.toBe((await render(msgs[2])).text);
});

// ---- 2.7.3 CLI

async function cli(argv: string[], over: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const mailer = new MemoryMailer();
  const code = await runCli(argv, { pool: ctx.pool, keyring: RING_V1, mode: 'enforce', alertTo: [ALERT_TO], mailer, out: (l) => void out.push(l), err: (l) => void err.push(l), ...over });
  return { code, out, err, mailer };
}
const ticketIn = (out: string[]) => /^등록 코드: (\d{4}) (\d{4})/.exec(out.find((l) => l.startsWith('등록 코드: '))!)!.slice(1).join('');

test('CLI 입력 검증: 명령·작업자·사유·이메일, 사용법 오류 2, 나머지 1', async () => {
  const a = await enrolledAdmin();
  expect((await cli([])).code).toBe(2);
  expect((await cli(['boom', '--operator', 'x'])).code).toBe(2);
  expect((await cli(['mfa-report', '--unknown'])).code).toBe(2);
  for (const op of ['', 'a;b', 'a=b', 'x'.repeat(51), 'a\nb']) {
    const r = await cli(['mfa-report', '--operator', op]);
    expect(r.code, JSON.stringify(op)).toBe(1);
    expect(r.err[0]).toContain('--operator');
  }
  expect((await cli(['mfa-reset', '--operator', '개발', '--reason', 'lost_phone'])).err[0]).toContain('--email');
  expect((await cli(['mfa-reset', '--email', a.email, '--operator', '개발', '--reason', 'other'])).code).toBe(1);
  expect((await cli(['mfa-unlock', '--email', a.email, '--operator', '개발', '--reason', 'lost_phone'])).code).toBe(1);
  expect((await cli(['mfa-reset', '--email', 'nobody@bara-edu.kr', '--operator', '개발', '--reason', 'lost_phone'])).err[0]).toBe('대상 계정을 찾을 수 없습니다');
  expect((await cli(['mfa-reset', '--email', a.email, '--operator', '개발', '--reason', 'lost_phone'], { keyring: null })).code).toBe(1);
  expect(await q('select 1 from auth.mfa_factors where user_id = $1', [a.id])).toHaveLength(1);
});

test('CLI mfa-reset: 초기화·등록 코드(경고 뒤 한 번)·기록 by=db·알림(INTRO-3-DB), 기록 실패면 아무것도 안 바뀜', async () => {
  const a = await enrolledAdmin();
  await mfaSession(ctx, a.id);
  const failed = await withFailingLog(() => cli(['mfa-reset', '--email', a.email.toUpperCase(), '--operator', '개발 담당', '--reason', 'sole_admin_locked']));
  expect(failed.code).toBe(1);
  expect(failed.err[0]).toBe('접속 기록을 남기지 못해 아무것도 바꾸지 않았습니다');
  expect(await q('select 1 from auth.mfa_factors where user_id = $1', [a.id])).toHaveLength(1);
  expect(await q('select 1 from auth.sessions where user_id = $1', [a.id])).toHaveLength(1);

  const r = await cli(['mfa-reset', '--email', a.email.toUpperCase(), '--operator', '개발 담당', '--reason', 'sole_admin_locked']);
  expect(r.code).toBe(0);
  const w = r.out.indexOf(TICKET_WARNING);
  expect(w).toBeGreaterThanOrEqual(0);
  expect(r.out[w + 1]).toMatch(/^등록 코드: \d{4} \d{4} \(유효: .+까지\)$/);
  expect(r.out.filter((l) => /\d{4} \d{4}/.test(l))).toHaveLength(1);
  expect(await q('select 1 from auth.mfa_factors where user_id = $1', [a.id])).toHaveLength(0);
  expect(await q('select 1 from auth.sessions where user_id = $1', [a.id])).toHaveLength(0);
  expect((await logsOf(ctx, a.id)).at(-1)).toMatchObject({ admin_id: a.id, action: '2단계인증초기화', detail: 'by=db;operator=개발 담당;reason=sole_admin_locked', ip_address: null });
  expect(r.mailer.sent.find((m) => m.to === a.email)).toMatchObject({ template: 'mfa_reset', by: 'db' });
  expect(r.mailer.sent.find((m) => m.to === ALERT_TO)).toMatchObject({ template: 'admin_security_alert', event: 'reset' });
  // 발급된 등록 코드로 다시 등록할 수 있다
  const ch = await challenge(a.email);
  expect((await call('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: ch.challengeToken, enrollTicket: ticketIn(r.out) })).statusCode).toBe(200);
  // 메일러가 없으면 보내지 못한 수를 알린다
  const b = await enrolledAdmin();
  const nm = await cli(['mfa-reset', '--email', b.email, '--operator', '개발', '--reason', 'key_lost'], { mailer: null });
  expect(nm.code).toBe(0);
  expect(nm.err.join('\n')).toContain('MAIL_FROM 없음');
});

test('CLI mfa-ticket: 등록된 계정은 거절, 첫 관리자·승격 계정에 발급(ticket_required, 기록 2단계인증등록코드발급)', async () => {
  const en = await enrolledAdmin();
  const refused = await cli(['mfa-ticket', '--email', en.email, '--operator', '개발']);
  expect(refused.code).toBe(1);
  expect(refused.err[0]).toContain('mfa-reset');
  const learner = await addUser(ctx);
  expect((await cli(['mfa-ticket', '--email', learner.email, '--operator', '개발'])).code).toBe(1);
  const a = await addUser(ctx, { admin: true });
  const r = await cli(['mfa-ticket', '--email', a.email, '--operator', '개발']);
  expect(r.code).toBe(0);
  expect(r.out[0]).toBe(TICKET_WARNING);
  expect((await q('select ticket_required_at is not null as t from auth.mfa_account_state where user_id = $1', [a.id]))[0].t).toBe(true);
  expect((await logsOf(ctx, a.id)).at(-1)).toMatchObject({ action: '2단계인증등록코드발급', detail: 'by=db;operator=개발' });
  // m-3: 다른 관리자·운영 주소에 알림, 본인 메일 없음, 메일에 등록 코드 없음
  expect(r.mailer.sent.filter((m) => m.to === ALERT_TO)).toEqual([expect.objectContaining({ template: 'admin_security_alert', event: 'ticket_issued' })]);
  expect(r.mailer.sent.some((m) => m.to === a.email)).toBe(false);
  const code = r.out.find((l) => l.startsWith('등록 코드:'))!.replace(/\D/g, '').slice(0, 8);
  expect(JSON.stringify(r.mailer.sent)).not.toContain(code);
  // optional에서도 입구 A는 닫히고 입구 B로만
  expect((await challenge(a.email, apps.optional)).mfa).toBe('enroll_required');
});

test('CLI mfa-clear: 아직 관리자면 거절, 강등 뒤 정리(reason=demoted), 다시 승격하면 등록 코드 필요', async () => {
  const a = await enrolledAdmin();
  expect((await cli(['mfa-clear', '--email', a.email, '--operator', '개발'])).code).toBe(1);
  await setRole(ctx, a.id, 'learner');
  const r = await cli(['mfa-clear', '--email', a.email, '--operator', '개발']);
  expect(r.code).toBe(0);
  for (const t of ['mfa_factors', 'mfa_recovery_codes', 'mfa_enroll_tickets', 'mfa_enrollments']) expect(await q(`select 1 from auth.${t} where user_id = $1`, [a.id])).toHaveLength(0);
  expect((await logsOf(ctx, a.id)).at(-1)).toMatchObject({ action: '2단계인증초기화', detail: 'by=db;operator=개발;reason=demoted' });
  await setRole(ctx, a.id, 'admin');
  expect((await challenge(a.email, apps.optional))).toMatchObject({ mfa: 'enroll_required', enrollReason: 'reset' });
});

test('CLI mfa-unlock: 두 bucket(실패·풀린 실패)을 지우고 기록, 등록 정보는 그대로', async () => {
  const a = await enrolledAdmin();
  await q("insert into auth.rate_events (bucket, key) select b, $1 from unnest(array['mfa-fail','mfa-fail','mfa-fail-released']) b", [a.id]);
  await q("insert into auth.rate_events (bucket, key) values ('mfa-lock-mail-account', $1)", [a.id]);
  const r = await cli(['mfa-unlock', '--email', a.email, '--operator', '개발', '--reason', 'owner_locked']);
  expect(r.code).toBe(0);
  expect(r.out[0]).toContain('3건');
  expect(await q("select bucket from auth.rate_events where key = $1", [a.id])).toEqual([{ bucket: 'mfa-lock-mail-account' }]);
  expect((await logsOf(ctx, a.id)).at(-1)).toMatchObject({ action: '2단계인증잠금해제', detail: 'by=db;operator=개발;reason=owner_locked' });
  // m-3: 다른 관리자·운영 주소에 알림, 본인 메일 없음
  expect(r.mailer.sent.filter((m) => m.to === ALERT_TO)).toEqual([expect.objectContaining({ template: 'admin_security_alert', event: 'unlocked' })]);
  expect(r.mailer.sent.some((m) => m.to === a.email)).toBe(false);
  expect(await q('select 1 from auth.mfa_factors where user_id = $1', [a.id])).toHaveLength(1);
});

test('N-5 CLI mfa-unlock: 탈퇴(withdrawn) 관리자는 거절하고 실패 기록·접속 기록·메일을 남기지 않는다', async () => {
  const a = await enrolledAdmin();
  await q("insert into auth.rate_events (bucket, key) values ('mfa-fail', $1)", [a.id]);
  await q(`begin; set local session_replication_role = replica; update profiles set status = 'withdrawn' where id = '${a.id}'; commit`);
  const before = (await logsOf(ctx, a.id)).length;
  const r = await cli(['mfa-unlock', '--email', a.email, '--operator', '개발', '--reason', 'owner_locked']);
  expect(r.code).toBe(1);
  expect(r.err.join('\n')).toContain('활성 관리자가 아닙니다');
  expect(await q("select 1 from auth.rate_events where key = $1 and bucket = 'mfa-fail'", [a.id])).toHaveLength(1);
  expect(await logsOf(ctx, a.id)).toHaveLength(before);
  expect(r.mailer.sent).toHaveLength(0);
});

test('I-8 CLI mfa-report: 관리자마다 등록 일시·IP·경로·복구 코드·최근 로그인 IP, 비밀 값 없음', async () => {
  const a = await enrolledAdmin('점검관리자');
  await q("update auth.mfa_factors set enrolled_ip = '198.51.100.7', enrolled_via = 'ticket' where user_id = $1", [a.id]);
  await call('POST', '/v1/auth/login', { email: a.email, password: PASSWORD }, { 'x-bara-client-ip': '198.51.100.9' });
  const ch = (await challenge(a.email)).challengeToken;
  await call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: codeAt(a.secret) }, { 'x-bara-client-ip': '198.51.100.9' });
  const fresh = await addUser(ctx, { admin: true, name: '미등록관리자' });
  const r = await cli(['mfa-report', '--operator', '대표']);
  expect(r.code).toBe(0);
  expect(r.out[0]).toMatch(/^현재 모드: enforce {2}활성 관리자: \d+명$/);
  const line = r.out.find((l) => l.includes(a.email))!;
  expect(line).toContain('점검관리자');
  expect(line).toMatch(/등록: 예\(.+, 경로 ticket, IP 198\.51\.100\.7\)/);
  expect(line).toContain('6자리 로그인: 1회');
  const idx = r.out.indexOf(line);
  expect(r.out[idx + 1]).toMatch(/최근 로그인 .+ IP 198\.51\.100\.9 \(mfa=totp\)/);
  expect(r.out.find((l) => l.includes(fresh.email))).toContain('등록: 아니오');
  const all = r.out.join('\n');
  expect(all).not.toMatch(/\b\d{6}\b|\b\d{8}\b|otpauth|[A-Z2-7]{32}/);
  expect((await logsOf(ctx, a.id)).map((l) => l.detail)).toEqual(['mfa=totp']); // 보고는 기록을 남기지 않는다(조회 전용). enforce의 비밀번호 단계는 기록 없음
});

test('CLI admin-sessions-revoke: 관리자 세션만 전부 삭제', async () => {
  const a = await enrolledAdmin();
  const l = await addUser(ctx);
  await mfaSession(ctx, a.id);
  const ls = await mfaSession(ctx, l.id);
  const r = await cli(['admin-sessions-revoke', '--operator', '개발']);
  expect(r.code).toBe(0);
  expect(r.out[0]).toMatch(/^관리자 세션 \d+개를 지웠습니다\.$/);
  expect(await q('select 1 from auth.sessions s join profiles p on p.id = s.user_id where p.role = $1', ['admin'])).toHaveLength(0);
  expect((await call('GET', '/v1/auth/session', undefined, S(ls))).statusCode).toBe(200);
});

test('운영 명령의 키가 API의 키(auth.mfa_key_check)와 다르면 rekey·reset·ticket 모두 쓰기 전에 멈춘다', async () => {
  const wrongV1 = makeKeyring(new Map([[1, Buffer.alloc(32, 7)]]), 1);
  const wrongBoth = makeKeyring(new Map([[1, Buffer.alloc(32, 7)], [2, Buffer.alloc(32, 8)]]), 2);
  const a = await enrolledAdmin();
  const fresh = await addUser(ctx, { admin: true });
  const snap = async () => ({
    factors: await q('select user_id, encode(secret_ciphertext, $1) c, key_version from auth.mfa_factors order by user_id', ['hex']),
    tickets: await q('select user_id from auth.mfa_enroll_tickets order by user_id'),
    checks: await q('select key_version, encode(ciphertext, $1) c from auth.mfa_key_check order by 1', ['hex']),
    logs: (await q('select count(*)::int n from admin_access_logs'))[0].n,
    sessions: (await q('select count(*)::int n from auth.sessions'))[0].n,
  });
  await mfaSession(ctx, a.id);
  const before = await snap();
  const runs = [
    await cli(['mfa-rekey', '--operator', '개발'], { keyring: wrongBoth }),
    await cli(['mfa-reset', '--email', a.email, '--operator', '개발', '--reason', 'lost_phone'], { keyring: wrongV1 }),
    await cli(['mfa-ticket', '--email', fresh.email, '--operator', '개발'], { keyring: wrongV1 }),
  ];
  for (const r of runs) {
    expect(r.code).toBe(1);
    expect(r.err[0]).toContain(KEY_MISMATCH_MESSAGE);
    expect(r.out.join('\n')).not.toMatch(/등록 코드: \d/);
    expect(r.mailer.sent).toHaveLength(0);
  }
  expect(await snap()).toEqual(before);
});

// ---- 2.14 모드 전환

test('I-2 모드 전환: 모드가 바뀐 첫 시작에만 비밀번호만의 관리자 세션 삭제(2단계 세션·학습자 세션은 유지), 같은 모드 재시작은 그대로', async () => {
  await q("insert into auth.mfa_runtime (id, mode, changed_at) values (1, 'off', now()) on conflict (id) do update set mode = 'off'");
  const a = await addUser(ctx, { admin: true });
  const l = await addUser(ctx);
  const pw = (await createSession(ctx.pool as pg.Pool, a.id, 30)).token;
  const two = await mfaSession(ctx, a.id);
  const ls = (await createSession(ctx.pool as pg.Pool, l.id, 30)).token;
  const lines: Array<[string, object]> = [];
  const log = { info: (o: object, m?: string) => void lines.push(['info', { ...o, m }]), warn: (o: object, m?: string) => void lines.push(['warn', { ...o, m }]) };
  await initMfa(ctx.pool as pg.Pool, { mode: 'optional', graceUntil: null, alertTo: [], keyring: RING_V1 }, log);
  expect(lines.map(([lv, o]) => [lv, (o as { event: string }).event])).toEqual([['info', 'mfa_mode'], ['info', 'mfa_mode_changed'], ['warn', 'mfa_mode_weak']]);
  expect(lines[1][1]).toMatchObject({ previous: 'off', mode: 'optional', deletedAdminSessions: 1 });
  expect(JSON.stringify(lines)).not.toContain(MASTER_V1);
  expect((await apps.optional.call('GET', '/v1/auth/session', undefined, S(pw))).statusCode).toBe(401);
  expect((await apps.optional.call('GET', '/v1/auth/session', undefined, S(two))).statusCode).toBe(200);
  expect((await apps.optional.call('GET', '/v1/auth/session', undefined, S(ls))).statusCode).toBe(200);
  // 같은 모드로 다시 시작: 삭제 없음(입구 A에 쓰는 유예 중 비밀번호 세션이 살아 있어야 한다)
  const pw2 = (await createSession(ctx.pool as pg.Pool, a.id, 30)).token;
  expect(await applyModeTransition(ctx.pool as pg.Pool, 'optional')).toEqual({ changed: false, deletedSessions: 0, previous: 'optional' });
  expect((await apps.optional.call('GET', '/v1/auth/session', undefined, S(pw2))).statusCode).toBe(200);
  expect((await applyModeTransition(ctx.pool as pg.Pool, 'enforce')).deletedSessions).toBe(1);
  expect((await q('select mode from auth.mfa_runtime'))[0].mode).toBe('enforce');
});

test('I-1 초기화된 계정은 optional·off에서도 등록 코드 없이 다시 등록할 수 없다(입구 A 거절, 로그인은 enroll_required)', async () => {
  const req = await enrolledAdmin();
  const a = await enrolledAdmin();
  expect((await reset(await mfaSession(ctx, req.id), a.id, { code: codeAt(req.secret) })).statusCode).toBe(200);
  for (const mode of ['off', 'optional'] as const) {
    expect(await challenge(a.email, apps[mode])).toMatchObject({ mfa: 'enroll_required', enrollReason: 'reset' });
  }
  // off의 비밀번호 세션(guard는 살려 둠)으로도 입구 A는 열리지 않는다
  const pw = (await createSession(ctx.pool as pg.Pool, a.id, 30)).token;
  const r = await apps.off.call('POST', '/v1/auth/mfa/enroll/start', {}, S(pw));
  expect(r.statusCode).toBe(409);
  expect(r.json().error.message).toBe('ticket_required');
  expect(await q('select 1 from auth.mfa_enrollments where user_id = $1', [a.id])).toHaveLength(0);
});

// ---- 2.6 키

test('키 검증(auth.mfa_key_check): 첫 시작에 현재 버전 행 생성, 다른 키면 시작 거절, 행 없는 옛 버전도 거절', async () => {
  const cfg = (keyring: MfaKeyring) => ({ mode: 'enforce' as const, graceUntil: null, alertTo: [], keyring });
  const log = { info() {}, warn() {} };
  await initMfa(ctx.pool as pg.Pool, cfg(RING_V1), log);
  expect(await q('select key_version from auth.mfa_key_check')).toEqual([{ key_version: 1 }]);
  const wrong = makeKeyring(new Map([[1, Buffer.alloc(32, 9)]]), 1);
  await expect(initMfa(ctx.pool as pg.Pool, cfg(wrong), log)).rejects.toThrow(MfaKeyError);
  const orphan = makeKeyring(new Map([[1, Buffer.from(MASTER_V1, 'base64')], [3, Buffer.alloc(32, 3)]]), 1);
  await expect(initMfa(ctx.pool as pg.Pool, cfg(orphan), log)).rejects.toThrow(MfaKeyError);
});

test('I-5 키 교체: 현재 v2에서 v1 복구 코드·v1 등록 코드 검증 성공, 새 값은 v2. mfa-rekey가 등록을 v2로 다시 암호화', async () => {
  const v2 = mfaApp(ctx, { mode: 'enforce', keys: `1=${MASTER_V1},2=${MASTER_V2}`, current: '2' });
  await v2.app.ready();
  const c2 = caller(v2.app);
  try {
    const a = await enrolledAdmin();
    const codes = (await call('POST', '/v1/auth/mfa/recovery-codes', { code: codeAt(a.secret) }, S(await mfaSession(ctx, a.id)))).json().recoveryCodes as string[];
    expect((await q('select distinct key_version from auth.mfa_recovery_codes where user_id = $1', [a.id]))).toEqual([{ key_version: 1 }]);
    const ch = (await c2('POST', '/v1/auth/login', { email: a.email, password: PASSWORD })).json().challengeToken;
    expect((await c2('POST', '/v1/auth/mfa/recover', { challengeToken: ch, recoveryCode: codes[0] })).statusCode).toBe(200);
    const rs = (await createSession(ctx.pool as pg.Pool, a.id, 30, { mfaMethod: 'totp' })).token;
    await clearLastStep(ctx, a.id);
    expect((await c2('POST', '/v1/auth/mfa/recovery-codes', { code: codeAt(a.secret) }, S(rs))).statusCode).toBe(200); // v1 등록 복호화
    expect((await q('select distinct key_version from auth.mfa_recovery_codes where user_id = $1', [a.id]))).toEqual([{ key_version: 2 }]);

    const b = await addUser(ctx, { admin: true });
    const t = await withService(ctx.pool, async (tx) => {
      await tx.query('insert into auth.mfa_account_state (user_id, ticket_required_at) values ($1, now())', [b.id]);
      return issueEnrollTicketIn(tx, RING_V1, b.id, null);
    });
    const bch = (await c2('POST', '/v1/auth/login', { email: b.email, password: PASSWORD })).json().challengeToken;
    expect((await c2('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: bch, enrollTicket: t.code })).statusCode).toBe(200);
    const e = (await c2('POST', '/v1/auth/mfa/enroll/start', { challengeToken: bch })).json();
    expect((await q('select key_version from auth.mfa_enrollments where id = $1', [e.enrollmentId]))[0].key_version).toBe(2);
    expect((await c2('POST', '/v1/auth/mfa/enroll/confirm', { challengeToken: bch, enrollmentId: e.enrollmentId, code: codeFromB32(e.secretBase32) })).statusCode).toBe(200);
    expect((await q('select key_version from auth.mfa_factors where user_id = $1', [b.id]))[0].key_version).toBe(2);

    // 3단계: mfa-rekey(버전이 하나뿐이면 거절)
    expect((await cli(['mfa-rekey', '--operator', '개발'])).code).toBe(1);
    const ring12 = makeKeyring(new Map([[1, Buffer.from(MASTER_V1, 'base64')], [2, Buffer.from(MASTER_V2, 'base64')]]), 2);
    // API가 v2 키로 먼저 시작해야 v2 검증 행이 생긴다. 그 전의 rekey는 거절(아무것도 안 바뀜)
    const before = await q('select user_id, key_version from auth.mfa_factors order by user_id');
    const early = await cli(['mfa-rekey', '--operator', '개발'], { keyring: ring12 });
    expect(early.code).toBe(1);
    expect(early.err[0]).toContain(KEY_MISMATCH_MESSAGE);
    expect(await q('select user_id, key_version from auth.mfa_factors order by user_id')).toEqual(before);
    await initMfa(ctx.pool as pg.Pool, { mode: 'enforce', graceUntil: null, alertTo: [], keyring: ring12 }, { info() {}, warn() {} });
    const r = await cli(['mfa-rekey', '--operator', '개발'], { keyring: ring12 });
    expect(r.code).toBe(0);
    expect(r.out[0]).toMatch(/^다시 암호화한 등록: [1-9]\d*건\(현재 버전 v2\)/);
    expect(await q('select 1 from auth.mfa_factors where key_version <> 2')).toHaveLength(0);
    expect(await q('select 1 from auth.mfa_enrollments')).toHaveLength(0);
    await clearLastStep(ctx, a.id);
    const ach = (await c2('POST', '/v1/auth/login', { email: a.email, password: PASSWORD })).json().challengeToken;
    expect((await c2('POST', '/v1/auth/mfa/verify', { challengeToken: ach, code: codeAt(a.secret) })).statusCode).toBe(200);
  } finally {
    // 다른 테스트(RING_V1)를 위해 v1로 되돌린다
    await cli(['mfa-rekey', '--operator', '개발'], { keyring: makeKeyring(new Map([[1, Buffer.from(MASTER_V1, 'base64')], [2, Buffer.from(MASTER_V2, 'base64')]]), 1) });
    await v2.app.close();
  }
});

test('AAD 용도: 등록 대기 암호문을 mfa_factors로 옮기면 복호화 실패 → 503 unavailable(번호를 받아 주지 않는다)', async () => {
  const a = await addUser(ctx, { admin: true });
  const pw = (await apps.optional.call('POST', '/v1/auth/login', { email: a.email, password: PASSWORD })).json().sessionToken;
  const e = (await apps.optional.call('POST', '/v1/auth/mfa/enroll/start', {}, S(pw))).json();
  await q(
    `insert into auth.mfa_factors (user_id, secret_ciphertext, secret_iv, key_version, confirmed_at, last_used_step, last_used_at, enrolled_via)
     select user_id, secret_ciphertext, secret_iv, key_version, now(), 0, now(), 'session' from auth.mfa_enrollments where id = $1`,
    [e.enrollmentId],
  );
  const ch = (await challenge(a.email)).challengeToken;
  const r = await call('POST', '/v1/auth/mfa/verify', { challengeToken: ch, code: codeFromB32(e.secretBase32) });
  expect(r.statusCode).toBe(503);
  expect(r.json().error.code).toBe('unavailable');
  expect(await q('select 1 from auth.sessions where user_id = $1 and mfa_at is not null', [a.id])).toHaveLength(0);
});

// ---- 9.4 로그

test('서버 로그 스트림에 6자리·복구 코드·등록 코드·대기표·secretBase32·otpauth가 없다', async () => {
  const lines: string[] = [];
  const la = mfaApp(ctx, { mode: 'enforce', logLines: lines });
  await la.app.ready();
  const c = caller(la.app);
  const secrets: string[] = [];
  try {
    const a = await addUser(ctx, { admin: true });
    const t = await withService(ctx.pool, async (tx) => {
      await tx.query('insert into auth.mfa_account_state (user_id, ticket_required_at) values ($1, now())', [a.id]);
      return issueEnrollTicketIn(tx, RING_V1, a.id, null);
    });
    const ch = (await c('POST', '/v1/auth/login', { email: a.email, password: PASSWORD })).json().challengeToken;
    await c('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: ch, enrollTicket: '00000000' });
    await c('POST', '/v1/auth/mfa/enroll/ticket', { challengeToken: ch, enrollTicket: t.code });
    const e = (await c('POST', '/v1/auth/mfa/enroll/start', { challengeToken: ch })).json();
    const code1 = codeFromB32(e.secretBase32);
    await c('POST', '/v1/auth/mfa/enroll/confirm', { challengeToken: ch, enrollmentId: e.enrollmentId, code: codeFromB32(e.secretBase32, 7) });
    const conf = (await c('POST', '/v1/auth/mfa/enroll/confirm', { challengeToken: ch, enrollmentId: e.enrollmentId, code: code1 })).json();
    const ch2 = (await c('POST', '/v1/auth/login', { email: a.email, password: PASSWORD })).json().challengeToken;
    await c('POST', '/v1/auth/mfa/verify', { challengeToken: ch2, code: code1 }); // code_reused
    await c('POST', '/v1/auth/mfa/recover', { challengeToken: ch2, recoveryCode: conf.recoveryCodes[1] });
    const req = await enrolledAdmin();
    const rr = (await c('POST', `/v1/admin/users/${a.id}/mfa-reset`, { code: codeAt(req.secret), reason: 'lost_phone', identityChecked: true }, S(await mfaSession(ctx, req.id)))).json();
    secrets.push(t.code, rr.enrollTicket, ch, ch2, e.secretBase32, conf.sessionToken, ...conf.recoveryCodes, ...conf.recoveryCodes.map((x: string) => x.replace('-', '')));
    const all = lines.join('');
    expect(lines.length).toBeGreaterThan(5);
    for (const s of secrets) expect(all.includes(s), s.slice(0, 3)).toBe(false);
    expect(all).not.toContain('otpauth');
    for (const six of [code1, codeFromB32(e.secretBase32, 7), codeAt(req.secret)]) expect(all).not.toMatch(new RegExp(`(?<![\\d.])${six}(?!\\d)`));
    expect(all).toContain('"event":"mfa_fail"');
  } finally {
    await la.app.close();
  }
});

test('m-3 알림 받을 곳이 없으면 CLI mfa-ticket·mfa-unlock은 메일 없이 기록에 alert=self_only', async () => {
  const a = await addUser(ctx, { admin: true });
  const others = await q("select id from public.profiles where role = 'admin' and id <> $1", [a.id]);
  const setRoles = (role: string) =>
    q(`begin; set local session_replication_role = replica; update public.profiles set role = '${role}' where id = any('{${others.map((o) => o.id).join(',')}}'::uuid[]); commit`);
  await setRoles('learner');
  try {
    const t = await cli(['mfa-ticket', '--email', a.email, '--operator', '개발'], { alertTo: [] });
    expect(t.code).toBe(0);
    expect(t.mailer.sent).toHaveLength(0);
    expect((await logsOf(ctx, a.id)).at(-1)?.detail).toBe('by=db;operator=개발;alert=self_only');
    const u = await cli(['mfa-unlock', '--email', a.email, '--operator', '개발', '--reason', 'owner_locked'], { alertTo: [] });
    expect(u.code).toBe(0);
    expect(u.mailer.sent).toHaveLength(0);
    expect((await logsOf(ctx, a.id)).at(-1)?.detail).toBe('by=db;operator=개발;reason=owner_locked;alert=self_only');
  } finally {
    await setRoles('admin');
  }
});
