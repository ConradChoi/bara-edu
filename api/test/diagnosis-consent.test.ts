import { afterAll, beforeAll, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { runJob } from '../src/jobs/scheduler.js';
import { setupTestDb } from './helpers/db.js';
import { CURRENT_SENSITIVE_CONSENT_VERSION, SENSITIVE_CONSENT_VERSIONS } from '../../data/diagnosis/consent.js';

// 자가진단 민감정보 별도 동의(docs/02-design/features/bara-edu-lms.diagnosis-sensitive-consent.md "API 계약" C1·C2·C3·C6).
const KEY = 'k'.repeat(32);
const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
const logLines: string[] = [];
const users: Record<string, { id: string; token: string }> = {};

const q = async (sql: string, p: unknown[] = []) => (await ctx.adminPool.query(sql, p)).rows;

beforeAll(async () => {
  ctx = await setupTestDb();
  app = buildApp({
    config: loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY }),
    pool: ctx.pool,
    mailer: new MemoryMailer(),
    storage: new MemoryStorage(),
    logger: { level: 'info', stream: { write: (l: string) => void logLines.push(l) } },
  });
  await app.ready();
  for (const k of ['me', 'other']) {
    const id = (await q('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [`${k}@example.com`]))[0].id as string;
    users[k] = { id, token: (await createSession(ctx.pool, id, 30)).token };
  }
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

function rpc(fn: string, args: unknown, who?: string) {
  const headers: Record<string, string> = { 'x-bara-service-key': KEY };
  if (who) headers['x-bara-session'] = users[who].token;
  return app.inject({ method: 'POST', url: `/v1/rpc/${fn}`, headers, payload: { args } as object });
}

const ANSWERS = Object.fromEntries([...'ABCDEF'].flatMap((p) => [1, 2, 3, 4, 5].map((n) => [`${p}${n}`, 4])));
let n = 0;
const args = (over: Record<string, unknown> = {}) => ({
  p_name: '진단자', p_phone: `010-3333-${String(++n).padStart(4, '0')}`, p_email: null, p_learning_experience: 'none', p_certificate_level: null,
  p_consent_privacy: true, p_consent_privacy_doc_version: 10, p_consent_sensitive: true, p_consent_sensitive_version: 'sc-v1',
  p_age_confirmed: true, p_answers: ANSWERS, ...over,
});
const resultCount = async () => Number((await q('select count(*) c from diagnosis_results'))[0].c);
async function submit(who?: string, over: Record<string, unknown> = {}) {
  const r = await rpc('submit_diagnosis', args(over), who);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().data[0] as { access_token: string; recommended_tier: string };
}
const rowOf = async (token: string) => (await q('select * from diagnosis_results where access_token = $1', [token]))[0];

// ---------------- 동의 문구 고정(5.2절) ----------------

const block = (sql: string, name: string) => {
  const a = sql.indexOf(`create or replace function public.${name}(`);
  return sql.slice(a, sql.indexOf('\n$$;', a) + 4);
};

test('sc-v1 원문은 고정돼 있다(바꾸려면 새 버전을 추가한다)', () => {
  const v1 = SENSITIVE_CONSENT_VERSIONS['sc-v1'];
  const hash = createHash('sha256').update(JSON.stringify(v1.text)).digest('hex');
  // 이 값이 바뀌었다면 배포된 동의 문구를 고친 것이다. 고치지 말고 sc-v2를 추가하고 허용 목록을 바꾼다.
  expect(hash).toBe('ba6189b065a8ed566dfec6f1665870a010f88877ce44d6317545b9d3e482f40a');
  // 법정 고지 4항목(목적·항목·보유 기간·거부권)이 모두 있다
  expect(v1.text.items.map((i) => i.key)).toEqual(['purpose', 'items', 'period', 'refuse']);
  expect(v1.text.withdraw).toContain('마이페이지');
});

test('DB 허용 목록은 consent.ts의 현재 버전 하나와 같다(스키마·패치 모두)', async () => {
  for (const file of ['02-schema.sql', 'patches/2026-11-26-diagnosis-consent.sql']) {
    const fn = block(await readFile(path.join(dbDir, file), 'utf8'), 'submit_diagnosis');
    const m = fn.match(/p_consent_sensitive_version = any \(array\[([^\]]*)\]\)/);
    expect(m, file).not.toBeNull();
    expect(m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))).toEqual([CURRENT_SENSITIVE_CONSENT_VERSION]);
  }
});

// ---------------- C1 제출 ----------------

test('비회원 제출: 동의 버전과 서버 시각이 결과 행에 남는다(클라이언트 시각 인자는 없다)', async () => {
  const before = (await q('select now() t'))[0].t as Date;
  const d = await submit();
  const row = await rowOf(d.access_token);
  expect(row).toMatchObject({ user_id: null, sensitive_consent_version: 'sc-v1', consent_privacy: true, consent_privacy_doc_version: 10 });
  expect(row.sensitive_consented_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  expect(row.sensitive_consented_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  expect(Number((await q('select count(*) c from diagnosis_answers where result_id = $1', [row.id]))[0].c)).toBe(30);
});

test('회원 제출: user_id와 동의 기록이 함께 저장된다', async () => {
  const d = await submit('me');
  expect(await rowOf(d.access_token)).toMatchObject({ user_id: users.me.id, sensitive_consent_version: 'sc-v1' });
});

test('민감정보 동의 거부(false·null·누락 아님): 400 validation field=consent reason=sensitive, 행이 생기지 않는다', async () => {
  const c0 = await resultCount();
  for (const v of [false, null]) {
    const r = await rpc('submit_diagnosis', args({ p_consent_sensitive: v }));
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toEqual({ code: 'validation', field: 'consent', reason: 'sensitive', message: '동의가 필요합니다.' });
  }
  expect(await resultCount()).toBe(c0);
});

test('검사 순서: 개인정보 동의가 먼저(reason=privacy), 그다음 민감정보, 그다음 버전, 그다음 만 14세', async () => {
  const e = async (over: Record<string, unknown>) => (await rpc('submit_diagnosis', args(over))).json().error;
  expect(await e({ p_consent_privacy: false, p_consent_sensitive: false, p_consent_sensitive_version: 'x' })).toMatchObject({ field: 'consent', reason: 'privacy' });
  expect(await e({ p_consent_sensitive: false, p_consent_sensitive_version: 'x', p_age_confirmed: false })).toMatchObject({ field: 'consent', reason: 'sensitive' });
  expect(await e({ p_consent_sensitive_version: 'x', p_age_confirmed: false })).toMatchObject({ field: 'consent_version' });
  expect(await e({ p_age_confirmed: false })).toMatchObject({ code: 'db_error', message: 'age confirmation required' });
});

test('동의 문구 버전이 허용 목록 밖이면 400 validation field=consent_version(앱 consent-outdated), 행이 생기지 않는다', async () => {
  const c0 = await resultCount();
  for (const v of ['sc-v0', 'sc-v2', 'SC-V1', '', null]) {
    const r = await rpc('submit_diagnosis', args({ p_consent_sensitive_version: v }));
    expect(r.statusCode, String(v)).toBe(400);
    expect(r.json().error).toEqual({ code: 'validation', field: 'consent_version', message: '동의 안내가 바뀌었습니다. 다시 동의해 주세요.' });
  }
  expect(await resultCount()).toBe(c0);
});

test('옛 앱처럼 새 인자 없이 부르면 400 validation(field 없음) — DB까지 가지 않는다', async () => {
  const old = args();
  delete (old as Record<string, unknown>).p_consent_sensitive;
  delete (old as Record<string, unknown>).p_consent_sensitive_version;
  const r = await rpc('submit_diagnosis', old);
  expect(r.statusCode).toBe(400);
  expect(r.json().error).toEqual({ code: 'validation', message: '요청 형식이 올바르지 않습니다.' });
});

// ---------------- DB 규칙: 동의 없는 결과는 어떤 경로로도 저장되지 않는다 ----------------

const insertRaw = (version: string | null, at: string | null) =>
  q(
    `insert into diagnosis_results (learning_experience, age_confirmed, version, score_theory, score_reading, score_analysis, score_counseling, score_case_record, score_teaching, total_score, recommended_tier, consent_privacy, sensitive_consent_version, sensitive_consented_at)
     values ('none', true, 'v1', 1,2,3,4,5,6, 10, 'level2', true, $1, $2) returning id`,
    [version, at],
  ).then(() => 'ok', (e: { code: string }) => e.code);

test('직접 insert(소유자 권한)도 동의 버전·시각이 없으면 거절된다', async () => {
  expect(await insertRaw(null, null)).toBe('23502'); // not null (정리 후 최종 상태)
  expect(await insertRaw('sc-v1', null)).toBe('23502');
  expect(await insertRaw(null, '2026-12-01T00:00:00Z')).toBe('23502');
  expect(await insertRaw('sc-v1', '2026-12-01T00:00:00Z')).toBe('ok');
  const c = await q("select convalidated from pg_constraint where conname = 'diagnosis_results_sensitive_consent_required'");
  expect(c).toEqual([{ convalidated: true }]);
});

test('검사 제약만으로도 막힌다(not null을 풀어도 check 위반 23514), 기존 행의 동의 기록을 지우는 update도 막힌다', async () => {
  const d = await submit();
  const cl = await ctx.adminPool.connect();
  try {
    await cl.query('begin');
    await cl.query('alter table diagnosis_results alter column sensitive_consent_version drop not null, alter column sensitive_consented_at drop not null');
    const err = await cl.query("insert into diagnosis_results (learning_experience, age_confirmed, version, score_theory, score_reading, score_analysis, score_counseling, score_case_record, score_teaching, total_score, recommended_tier, consent_privacy) values ('none', true, 'v1', 1,2,3,4,5,6, 10, 'level2', true)").then(() => 'ok', (e: { code: string }) => e.code);
    expect(err).toBe('23514');
  } finally {
    await cl.query('rollback');
    cl.release();
  }
  const upd = await q('update diagnosis_results set sensitive_consent_version = null where access_token = $1', [d.access_token]).then(() => 'ok', (e: { code: string }) => e.code);
  expect(upd).toBe('23502');
});

test('학습자·비회원 역할은 결과를 직접 insert·delete할 수 없다(RLS: 관리자 select만)', async () => {
  const d = await submit('me');
  const cl = await ctx.pool.connect();
  try {
    await cl.query('begin');
    await cl.query('set local role bara_edu_authenticated');
    await cl.query("select set_config('request.user_id', $1, true)", [users.me.id]);
    const del = await cl.query('delete from diagnosis_results where access_token = $1', [d.access_token]);
    expect(del.rowCount).toBe(0);
    await cl.query('rollback');
  } finally {
    cl.release();
  }
  expect(await rowOf(d.access_token)).toBeTruthy();
});

// ---------------- C2 셀프 삭제(동의 철회) ----------------

const del = (token: string, deleteLeads: boolean, who?: string) => rpc('delete_my_diagnosis_result', { p_token: token, p_delete_leads: deleteLeads }, who);
const lead = async (resultId: string, userId: string | null, name: string) =>
  (await q("insert into diagnosis_leads (result_id, user_id, name, contact, consent_contact) values ($1, $2, $3, 'c', true) returning id", [resultId, userId, name]))[0].id as string;
const leadRow = async (id: string) => (await q('select result_id from diagnosis_leads where id = $1', [id]))[0];

test('셀프 삭제: 세션 없으면 401 unauthenticated, 결과는 그대로', async () => {
  const d = await submit('me');
  const r = await del(d.access_token, true);
  expect(r.statusCode).toBe(401);
  expect(r.json().error.code).toBe('unauthenticated');
  expect(await rowOf(d.access_token)).toBeTruthy();
});

test('셀프 삭제: 남의 결과·미연결 비회원 결과·없는 토큰은 모두 false(구분 없음), 아무것도 지워지지 않는다', async () => {
  const others = await submit('other');
  const guest = await submit();
  for (const token of [others.access_token, guest.access_token, '00000000-0000-4000-8000-000000000000']) {
    const r = await del(token, true, 'me');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ data: false });
  }
  expect(await rowOf(others.access_token)).toBeTruthy();
  expect(await rowOf(guest.access_token)).toBeTruthy();
  expect((await del('nope', true, 'me')).statusCode).toBe(400);
});

test('셀프 삭제: 내 결과는 행째(응답·동의 기록 포함) 지워지고 결과 링크도 열리지 않는다. 두 번째는 false', async () => {
  const d = await submit('me');
  const id = (await rowOf(d.access_token)).id;
  const myLead = await lead(id, users.me.id, 'mine');
  const guestLead = await lead(id, null, 'guest');
  logLines.length = 0;
  const r = await del(d.access_token, true, 'me');
  expect(r.json()).toEqual({ data: true });
  expect(await rowOf(d.access_token)).toBeUndefined();
  expect(Number((await q('select count(*) c from diagnosis_answers where result_id = $1', [id]))[0].c)).toBe(0);
  expect(await leadRow(myLead)).toBeUndefined(); // 본인 문의는 함께 삭제
  expect(await leadRow(guestLead)).toEqual({ result_id: null }); // 본인 것이 아닌 문의는 남고 연결만 끊긴다
  const s = await rpc('get_diagnosis_summary', { p_token: d.access_token });
  expect(s.json().error).toMatchObject({ code: 'db_error', message: 'result not found' });
  expect((await del(d.access_token, true, 'me')).json()).toEqual({ data: false });

  // 처리 사실만 서버 로그에 한 줄(가명 userId). 토큰·이름은 남기지 않는다
  const ev = logLines.map((l) => JSON.parse(l)).filter((e) => e.event === 'diagnosis_consent_withdrawn');
  expect(ev[0]).toMatchObject({ userId: users.me.id, deleted: true, deleteLeads: true });
  expect(logLines.join('\n')).not.toContain(d.access_token);
});

test('셀프 삭제: p_delete_leads=false면 본인 문의도 남고 result_id만 비워진다', async () => {
  const d = await submit('me');
  const id = (await rowOf(d.access_token)).id;
  const myLead = await lead(id, users.me.id, 'keep');
  expect((await del(d.access_token, false, 'me')).json()).toEqual({ data: true });
  expect(await leadRow(myLead)).toEqual({ result_id: null });
});

test('셀프 삭제 함수: 비회원 역할·PUBLIC은 실행 권한이 없고 회원 역할만 있다', async () => {
  const r = await q(
    "select has_function_privilege('bara_edu_anon', 'public.delete_my_diagnosis_result(uuid, boolean)', 'execute') a, has_function_privilege('public', 'public.delete_my_diagnosis_result(uuid, boolean)', 'execute') p, has_function_privilege('bara_edu_authenticated', 'public.delete_my_diagnosis_result(uuid, boolean)', 'execute') u",
  );
  expect(r[0]).toEqual({ a: false, p: false, u: true });
});

// ---------------- C3 내 목록 has_lead ----------------

test('get_my_diagnosis_results: has_lead는 그 결과에 본인이 낸 문의가 있을 때만 true', async () => {
  await q('delete from diagnosis_results where user_id = $1', [users.other.id]);
  const a = await submit('other');
  const b = await submit('other');
  const c = await submit('other');
  await lead((await rowOf(a.access_token)).id, users.other.id, 'x');
  await lead((await rowOf(c.access_token)).id, null, 'guest'); // 본인 것이 아닌 문의는 세지 않는다
  const rows = (await rpc('get_my_diagnosis_results', {}, 'other')).json().data as { access_token: string; has_lead: boolean }[];
  const byToken = Object.fromEntries(rows.map((r) => [r.access_token, r.has_lead]));
  expect(byToken).toEqual({ [a.access_token]: true, [b.access_token]: false, [c.access_token]: false });
  expect(Object.keys(rows[0]).sort()).toEqual(['access_token', 'created_at', 'has_lead', 'recommended_tier', 'total_score']);
});

// ---------------- C6 90일 파기: 행 삭제 ----------------

test('90일 파기: 진단 90일 지난 비회원 결과는 행째 삭제(응답 포함, 문의는 연결만 끊김). 회원·90일 이내는 그대로', async () => {
  const mk = async (who: string | undefined, days: number) => {
    const d = await submit(who);
    await q("update diagnosis_results set created_at = now() - ($2 || ' days')::interval where access_token = $1", [d.access_token, String(days)]);
    return (await rowOf(d.access_token)).id as string;
  };
  await q("delete from diagnosis_results where user_id is null and created_at < now() - interval '90 days'");
  const old1 = await mk(undefined, 91);
  const old2 = await mk(undefined, 200);
  const young = await mk(undefined, 89);
  const member = await mk('me', 400);
  const l = await lead(old1, null, 'guest-old');

  expect(await runJob(ctx.pool, 'purge_unclaimed_diagnosis_pii')).toBe(2);
  const ids = (await q('select id from diagnosis_results where id = any($1::uuid[])', [[old1, old2, young, member]])).map((r) => r.id);
  expect(ids.sort()).toEqual([young, member].sort());
  expect(Number((await q('select count(*) c from diagnosis_answers where result_id = any($1::uuid[])', [[old1, old2]]))[0].c)).toBe(0);
  expect(await leadRow(l)).toEqual({ result_id: null });
  expect(await runJob(ctx.pool, 'purge_unclaimed_diagnosis_pii')).toBe(0);
});
