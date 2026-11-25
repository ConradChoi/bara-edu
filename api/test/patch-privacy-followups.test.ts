import { afterAll, beforeAll, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb } from './helpers/db.js';

// 2026-11-26 패치: purge_unclaimed_diagnosis_pii()의 대상 조건 보완(이름 null + phone/email만 남은 행도 파기).
const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');
const PATCH = path.join(dbDir, 'patches', '2026-11-26-privacy-followups.sql');
const FN = 'purge_unclaimed_diagnosis_pii';
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let patch: string;
let schema: string;

beforeAll(async () => {
  ctx = await setupTestDb();
  patch = await readFile(PATCH, 'utf8');
  schema = await readFile(path.join(dbDir, '02-schema.sql'), 'utf8');
});
afterAll(async () => {
  await ctx.close();
});

const block = (sql: string, name: string) => {
  const a = sql.indexOf(`create or replace function public.${name}(`);
  return sql.slice(a, sql.indexOf('\n$$;', a) + 4);
};
const q = async (sql: string, params: unknown[] = []) => (await ctx.adminPool.query(sql, params)).rows;

test('패치는 create or replace function 1개와 drop policy if exists 1개만 담고 역할 전환·grant 변경이 없다', () => {
  const noComments = patch.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const skeleton = noComments.replace(/\$\$[\s\S]*?\$\$/g, '$$$$');
  const statements = skeleton.split(';').map((s) => s.trim()).filter(Boolean);
  expect(statements).toHaveLength(2);
  expect(statements[0]).toMatch(/^create or replace function public\.purge_unclaimed_diagnosis_pii\(/);
  expect(statements[1]).toBe('drop policy if exists diagnosis_leads_admin_update on public.diagnosis_leads');
  expect(skeleton).not.toMatch(/\b(alter|truncate|grant|revoke)\b|\bdrop\s+(?!policy if exists diagnosis_leads_admin_update)|set\s+(local\s+)?role/i);
});

test('스키마에는 리드 update 정책이 없다(drop만 남음)', () => {
  expect(schema).not.toMatch(/create policy "diagnosis_leads_admin_update"/);
  expect(schema).toMatch(/drop policy if exists "diagnosis_leads_admin_update" on diagnosis_leads/);
});

test('패치의 함수 정의는 02-schema.sql과 글자 그대로 같다', () => {
  expect(block(patch, FN)).toBe(block(schema, FN));
});

test('이름은 null이고 phone·email만 남은 90일 지난 비회원 행도 비워진다', async () => {
  const mk = async (name: string | null, phone: string | null, email: string | null, days: number) =>
    (
      await q(
        `insert into diagnosis_results (respondent_name, phone, email, certificate_level, utm_source, learning_experience, age_confirmed, version, score_theory, score_reading, score_analysis, score_counseling, score_case_record, score_teaching, total_score, recommended_tier, consent_privacy, created_at)
         select $1,$2,$3,'lv','utm', e, true, 'v1', 1,2,3,4,5,6, 10, t, true, now() - ($4 || ' days')::interval from (select (enum_range(null::diagnosis_experience))[1] e, (enum_range(null::diagnosis_tier))[1] t) s
         returning id`,
        [name, phone, email, String(days)],
      )
    )[0].id as string;
  const phoneOnly = await mk(null, '01012345678', null, 91);
  const emailOnly = await mk(null, null, 'a@b.c', 91);
  const nameOnly = await mk('이름', null, null, 91);
  const young = await mk(null, '01099998888', null, 10);
  const empty = await mk(null, null, null, 91);

  const r = await q(`select public.${FN}() as n`);
  expect(Number(r[0].n)).toBe(3); // 이미 빈 행(empty)은 세지 않는다

  const get = async (id: string) => (await q('select respondent_name, phone, email, certificate_level, utm_source, total_score from diagnosis_results where id = $1', [id]))[0];
  for (const id of [phoneOnly, emailOnly, nameOnly]) {
    const row = await get(id);
    expect([row.respondent_name, row.phone, row.email, row.certificate_level, row.utm_source]).toEqual([null, null, null, null, null]);
    expect(Number(row.total_score)).toBe(10);
  }
  expect((await get(young)).phone).toBe('01099998888');
  expect((await get(empty)).phone).toBeNull();
});

test('패치를 소유자 역할로 여러 번 적용해도 성공하고 소유자·권한(proacl)·본문이 그대로다', async () => {
  const snap = async () => (await q("select proacl::text as acl, proowner::regrole::text as owner, md5(prosrc) as src from pg_proc where proname = $1", [FN]))[0];
  const before = await snap();
  for (let i = 0; i < 2; i++) {
    const c = await ctx.adminPool.connect();
    try {
      await c.query('begin');
      await c.query('set local role bara_edu_service');
      await c.query(patch);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  expect(await snap()).toEqual(before);
  const x = await q("select has_function_privilege('bara_edu_anon', 'public.purge_unclaimed_diagnosis_pii()', 'execute') a, has_function_privilege('bara_edu_authenticated', 'public.purge_unclaimed_diagnosis_pii()', 'execute') b");
  expect(x[0]).toEqual({ a: false, b: false });
});

test('정책 제거 후 관리자(authenticated)의 리드 직접 update는 막히고 select는 된다. 패치를 두 번 적용해도 오류가 없다', async () => {
  // 옛 정책이 있던 상태를 만들어 패치가 실제로 지우는지 본다
  await ctx.adminPool.query('drop policy if exists diagnosis_leads_admin_update on public.diagnosis_leads');
  await ctx.adminPool.query('create policy diagnosis_leads_admin_update on public.diagnosis_leads for update using (is_admin())');
  for (let i = 0; i < 2; i++) {
    const c = await ctx.adminPool.connect();
    try {
      await c.query('begin');
      await c.query('set local role bara_edu_service');
      await c.query(patch);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  expect(await q("select 1 from pg_policies where tablename = 'diagnosis_leads' and policyname = 'diagnosis_leads_admin_update'")).toHaveLength(0);

  const admin = (await q("insert into auth.users (email, email_confirmed_at) values ('pa@example.com', now()) returning id"))[0].id as string;
  await ctx.adminPool.query(`begin; set local session_replication_role = replica; update profiles set role='admin' where id='${admin}'; commit`);
  const lead = (await q("insert into diagnosis_leads (name, contact, consent_contact) values ('n','c',true) returning id"))[0].id as string;
  const c = await ctx.adminPool.connect();
  try {
    await c.query('begin');
    await c.query('set local role bara_edu_authenticated');
    await c.query("select set_config('request.user_id', $1, true)", [admin]);
    expect((await c.query('select id from diagnosis_leads where id = $1', [lead])).rowCount).toBe(1);
    const upd = await c.query("update diagnosis_leads set admin_note = 'x' where id = $1", [lead]).then((r) => r.rowCount, (e: Error) => e.message);
    await c.query('rollback');
    expect(upd === 0 || typeof upd === 'string').toBe(true);
  } finally {
    c.release();
  }
  expect((await q('select admin_note from diagnosis_leads where id = $1', [lead]))[0].admin_note).toBeNull();
});
