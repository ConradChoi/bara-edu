import { afterAll, beforeAll, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRpcCatalog, RPC_ALLOW } from '../src/query/rpc.js';
import { setupTestDb } from './helpers/db.js';

// 2026-11-26 패치(민감정보 별도 동의)와 일회성 정리 스크립트.
// 운영 DB의 패치 전 상태(동의 컬럼 없음, 옛 submit_diagnosis·get_my_diagnosis_results, 이름 비우기 파기)를 만든 뒤
// 패치 -> 정리 스크립트 순서로 적용해 본다(정의서 "API 계약" 배포 순서 2·5).
const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');
const PATCH = path.join(dbDir, 'patches', '2026-11-26-diagnosis-consent.sql');
const CLEANUP = path.join(dbDir, 'patches', '2026-11-26-diagnosis-consent-cleanup.sql');
const OLD_PURGE_PATCH = path.join(dbDir, 'patches', '2026-11-26-privacy-followups.sql');
const NEW_SUBMIT = 'public.submit_diagnosis(text, text, text, diagnosis_experience, text, boolean, integer, boolean, text, boolean, jsonb, text, text, text)';
const OLD_SUBMIT = 'public.submit_diagnosis(text, text, text, diagnosis_experience, text, boolean, integer, boolean, jsonb, text, text, text)';

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let patch: string;
let cleanup: string;
let schema: string;
const legacy: { member1: string; member2: string; guest1: string; guest2: string; memberLead: string; guestLead: string; claimedGuestLead: string } = {} as never;
let memberId: string;

const q = async (sql: string, params: unknown[] = []) => (await ctx.adminPool.query(sql, params)).rows;

// 운영 적용 방식 그대로: 한 트랜잭션, bara_edu_service로 전환. NOTICE를 모아 돌려준다.
async function applyAsOwner(sql: string): Promise<string[]> {
  const c = await ctx.adminPool.connect();
  const notices: string[] = [];
  const onNotice = (m: { message?: string }) => void notices.push(String(m.message));
  c.on('notice', onNotice);
  try {
    await c.query('begin');
    await c.query('set local role bara_edu_service');
    await c.query(sql);
    await c.query('commit');
    return notices;
  } catch (err) {
    await c.query('rollback');
    throw err;
  } finally {
    c.off('notice', onNotice);
    c.release();
  }
}

beforeAll(async () => {
  ctx = await setupTestDb();
  patch = await readFile(PATCH, 'utf8');
  cleanup = await readFile(CLEANUP, 'utf8');
  schema = await readFile(path.join(dbDir, '02-schema.sql'), 'utf8');

  // 패치 전 운영 상태로 되돌린다(옛 함수는 시그니처·권한만 같으면 된다. 본문은 이 테스트에서 부르지 않는다).
  await applyAsOwner(`
    alter table diagnosis_results drop constraint diagnosis_results_sensitive_consent_required;
    alter table diagnosis_results drop column sensitive_consent_version, drop column sensitive_consented_at;
    drop index diagnosis_leads_result_id_idx;
    drop function ${NEW_SUBMIT};
    drop function public.delete_my_diagnosis_result(uuid, boolean);
    drop function public.get_my_diagnosis_results();
    create function public.submit_diagnosis(p_name text, p_phone text, p_email text, p_learning_experience diagnosis_experience, p_certificate_level text,
      p_consent_privacy boolean, p_consent_privacy_doc_version integer, p_age_confirmed boolean, p_answers jsonb,
      p_utm_source text default null, p_utm_medium text default null, p_utm_campaign text default null)
      returns table (access_token uuid, recommended_tier diagnosis_tier, total_score numeric) language sql as $$ select null::uuid, null::diagnosis_tier, null::numeric $$;
    grant execute on function ${OLD_SUBMIT} to bara_edu_anon, bara_edu_authenticated;
    create function public.get_my_diagnosis_results()
      returns table (access_token uuid, recommended_tier diagnosis_tier, total_score numeric, created_at timestamptz)
      language sql as $$ select null::uuid, null::diagnosis_tier, null::numeric, null::timestamptz where false $$;
    grant execute on function public.get_my_diagnosis_results() to bara_edu_authenticated;
  `);
  await applyAsOwner(await readFile(OLD_PURGE_PATCH, 'utf8'));

  // 변경 전(별도 동의 없는) 결과: 회원 2건, 비회원 2건(1건은 이미 90일 파기로 이름이 비워진 행). 응답·문의 연결 포함.
  memberId = (await q("insert into auth.users (email, email_confirmed_at) values ('legacy@example.com', now()) returning id"))[0].id;
  const mk = async (userId: string | null, name: string | null) =>
    (
      await q(
        `insert into diagnosis_results (user_id, respondent_name, phone, learning_experience, age_confirmed, version, score_theory, score_reading, score_analysis, score_counseling, score_case_record, score_teaching, total_score, recommended_tier, consent_privacy)
         values ($1, $2, '010', 'none', true, 'shape-v1', 1,2,3,4,5,6, 10, 'instructor_candidate', true) returning id`,
        [userId, name],
      )
    )[0].id as string;
  legacy.member1 = await mk(memberId, '회원1');
  legacy.member2 = await mk(memberId, '회원2');
  legacy.guest1 = await mk(null, '비회원1');
  legacy.guest2 = await mk(null, null);
  for (const id of [legacy.member1, legacy.member2, legacy.guest1, legacy.guest2]) {
    await q("insert into diagnosis_answers (result_id, item_code, score) select $1, p || n, 2 from unnest(array['A','B','C','D','E','F']) p, generate_series(1,5) n", [id]);
  }
  legacy.memberLead = (await q("insert into diagnosis_leads (result_id, user_id, name, contact, consent_contact) values ($1, $2, 'm', 'c', true) returning id", [legacy.member1, memberId]))[0].id;
  // 비회원 때 낸 문의가 이미 귀속된 결과에 붙어 있는 옛 데이터(claim이 user_id를 안 묶던 시절): 패치 backfill이 묶는다
  legacy.claimedGuestLead = (await q("insert into diagnosis_leads (result_id, name, contact, consent_contact) values ($1, 'c', 'c', true) returning id", [legacy.member2]))[0].id;
  legacy.guestLead = (await q("insert into diagnosis_leads (result_id, name, contact, consent_contact) values ($1, 'g', 'c', true) returning id", [legacy.guest1]))[0].id;
});
afterAll(async () => {
  await ctx.close();
});

const fnBlock = (sql: string, name: string) => {
  const a = sql.indexOf(`create or replace function public.${name}(`);
  expect(a, name).toBeGreaterThanOrEqual(0);
  return sql.slice(a, sql.indexOf('\n$$;', a) + 4);
};
const colsBlock = (sql: string) => {
  const a = sql.indexOf('-- ----- 자가진단 민감정보 별도 동의: 컬럼·제약 (2026-11-26) 시작');
  const end = '-- ----- 자가진단 민감정보 별도 동의: 컬럼·제약 끝\n';
  return sql.slice(a, sql.indexOf(end, a) + end.length);
};
const resultCount = async () => Number((await q('select count(*) c from diagnosis_results'))[0].c);
const canExec = async (role: string, fn: string) => (await q('select has_function_privilege($1, $2, $3) ok', [role, fn, 'execute']))[0].ok as boolean;

test('패치 형식: 역할 전환·데이터 변경(insert/update/delete/truncate)이 함수 본문 밖에 없다', () => {
  const noComments = patch.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const skeleton = noComments.replace(/\$\$[\s\S]*?\$\$/g, '$$$$');
  expect(skeleton).not.toMatch(/set\s+(local\s+)?role|\b(insert|delete|truncate)\b/i);
  // 데이터 변경은 비회원 문의 user_id backfill(update 한 문장) 하나뿐이다. 잠금 대기 제한이 파일 안에 있다
  expect(skeleton.match(/\bupdate\b/gi)).toHaveLength(1);
  expect(skeleton).toMatch(/update diagnosis_leads l set user_id = r\.user_id/);
  expect(skeleton).toMatch(/set local lock_timeout = '5s';/);
  // 일회성 정리는 패치에 없다(별도 스크립트, 앱 배포 뒤 실행)
  expect(skeleton).not.toMatch(/validate constraint|set not null/i);
  expect(cleanup.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')).not.toMatch(/set\s+(local\s+)?role/i);
});

test('패치의 컬럼 블록·함수 4개·drop 줄·인덱스는 02-schema.sql과 글자 그대로 같다', () => {
  expect(colsBlock(patch)).toBe(colsBlock(schema));
  expect(colsBlock(patch)).toContain('not valid');
  for (const fn of ['submit_diagnosis', 'purge_unclaimed_diagnosis_pii', 'get_my_diagnosis_results', 'delete_my_diagnosis_result', 'claim_diagnosis']) {
    expect(fnBlock(patch, fn), fn).toBe(fnBlock(schema, fn));
  }
  for (const line of [
    `drop function if exists ${OLD_SUBMIT};`,
    'drop function if exists public.get_my_diagnosis_results();',
    'create index if not exists diagnosis_leads_result_id_idx on diagnosis_leads(result_id);',
  ]) {
    expect(patch, line).toContain(line);
    expect(schema, line).toContain(line);
  }
  // 스키마(새 DB)는 정리 뒤 최종 상태까지 포함한다
  for (const line of [
    'alter table diagnosis_results validate constraint diagnosis_results_sensitive_consent_required;',
    'alter table diagnosis_results alter column sensitive_consent_version set not null;',
    'alter table diagnosis_results alter column sensitive_consented_at set not null;',
  ]) {
    expect(schema).toContain(line);
    expect(cleanup).toContain(line);
  }
});

test('패치 전에 정리 스크립트를 돌리면 실패하고 아무것도 지워지지 않는다(롤백)', async () => {
  await expect(applyAsOwner(cleanup)).rejects.toThrow();
  expect(await resultCount()).toBe(4);
});

test('패치를 소유자 역할로 두 번 적용: 성공, 기존 행·응답 그대로, 권한·본문 같음', async () => {
  const snap = async () =>
    q(
      `select p.oid::regprocedure::text fn, proacl::text acl, proowner::regrole::text owner, md5(prosrc) src from pg_proc p
        where pronamespace = 'public'::regnamespace and proname in ('submit_diagnosis','purge_unclaimed_diagnosis_pii','get_my_diagnosis_results','delete_my_diagnosis_result','claim_diagnosis') order by 1`,
    );
  await applyAsOwner(patch);
  const first = await snap();
  await applyAsOwner(patch);
  expect(await snap()).toEqual(first);
  expect(first.map((r) => r.fn)).toEqual([
    'claim_diagnosis(uuid)',
    'delete_my_diagnosis_result(uuid,boolean)',
    'get_my_diagnosis_results()',
    'purge_unclaimed_diagnosis_pii()',
    'submit_diagnosis(text,text,text,diagnosis_experience,text,boolean,integer,boolean,text,boolean,jsonb,text,text,text)',
  ]);
  expect(first.every((r) => r.owner === 'bara_edu_service')).toBe(true);
  expect(await resultCount()).toBe(4);
  // backfill: 귀속된 결과의 비회원 문의만 결과 회원에게 묶인다. 미귀속 결과의 문의는 그대로, 두 번째 적용은 0행
  const owners = async () => q('select id, user_id from diagnosis_leads order by name');
  expect(await owners()).toEqual([
    { id: legacy.claimedGuestLead, user_id: memberId },
    { id: legacy.guestLead, user_id: null },
    { id: legacy.memberLead, user_id: memberId },
  ]);
  expect(Number((await q('select count(*) c from diagnosis_answers'))[0].c)).toBe(120);
  const col = await q(`select attname, attnotnull from pg_attribute where attrelid = 'diagnosis_results'::regclass and attname like 'sensitive_%' order by 1`);
  expect(col).toEqual([{ attname: 'sensitive_consent_version', attnotnull: false }, { attname: 'sensitive_consented_at', attnotnull: false }]);
  expect(await q("select convalidated from pg_constraint where conname = 'diagnosis_results_sensitive_consent_required'")).toEqual([{ convalidated: false }]);
  expect(await q("select 1 from pg_indexes where indexname = 'diagnosis_leads_result_id_idx'")).toHaveLength(1);
});

test('패치 뒤 권한: 제출은 비회원·회원, 목록·삭제는 회원만, 파기는 API 서비스만, PUBLIC은 없음. RPC 카탈로그가 적재된다', async () => {
  expect(await canExec('bara_edu_anon', NEW_SUBMIT)).toBe(true);
  expect(await canExec('bara_edu_authenticated', NEW_SUBMIT)).toBe(true);
  for (const fn of ['public.get_my_diagnosis_results()', 'public.delete_my_diagnosis_result(uuid, boolean)']) {
    expect(await canExec('bara_edu_anon', fn), fn).toBe(false);
    expect(await canExec('bara_edu_authenticated', fn), fn).toBe(true);
  }
  for (const role of ['bara_edu_anon', 'bara_edu_authenticated']) expect(await canExec(role, 'public.purge_unclaimed_diagnosis_pii()')).toBe(false);
  for (const fn of [NEW_SUBMIT, 'public.get_my_diagnosis_results()', 'public.delete_my_diagnosis_result(uuid, boolean)', 'public.purge_unclaimed_diagnosis_pii()']) {
    expect(await canExec('public', fn), fn).toBe(false);
  }
  const cat = await loadRpcCatalog(ctx.pool);
  expect([...cat.keys()].sort()).toEqual([...RPC_ALLOW].sort());
  // 관리자 직접 select 정책은 없다(R-1). 리드 select 정책만 남는다
  const pol = await q("select tablename, policyname, cmd from pg_policies where tablename in ('diagnosis_results','diagnosis_answers','diagnosis_leads') order by 1, 2");
  expect(pol).toEqual([
    { tablename: 'diagnosis_leads', policyname: 'diagnosis_leads_admin_select', cmd: 'SELECT' },
  ]);
});

test('패치 뒤 정리 전: 새 제출은 동의 기록과 함께 저장되고, 동의 없는 새 행은 제약(23514)에 막힌다. 변경 전 결과 연결(claim)도 막힌다', async () => {
  const c = await ctx.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role bara_edu_anon');
    const answers = Object.fromEntries([...'ABCDEF'].flatMap((p) => [1, 2, 3, 4, 5].map((n) => [`${p}${n}`, 3])));
    const r = await c.query(
      `select * from public.submit_diagnosis(p_name => '새사람', p_phone => '010-9999-0000', p_email => null, p_learning_experience => 'none', p_certificate_level => null,
         p_consent_privacy => true, p_consent_privacy_doc_version => 10, p_consent_sensitive => true, p_consent_sensitive_version => 'sc-v1', p_age_confirmed => true, p_answers => $1::jsonb)`,
      [JSON.stringify(answers)],
    );
    await c.query('commit');
    expect(r.rows).toHaveLength(1);
  } finally {
    c.release();
  }
  expect(await q("select sensitive_consent_version v from diagnosis_results where respondent_name = '새사람'")).toEqual([{ v: 'sc-v1' }]);
  const err = await q(
    `insert into diagnosis_results (learning_experience, age_confirmed, version, score_theory, score_reading, score_analysis, score_counseling, score_case_record, score_teaching, total_score, recommended_tier, consent_privacy)
     values ('none', true, 'v1', 1,2,3,4,5,6, 10, 'level2', true)`,
  ).then(() => 'ok', (e: { code: string }) => e.code);
  expect(err).toBe('23514');
  const claim = await q('update diagnosis_results set user_id = $2 where id = $1', [legacy.guest1, memberId]).then(() => 'ok', (e: { code: string }) => e.code);
  expect(claim).toBe('23514');
});

test('정리 스크립트: 동의 없는 결과만 행째 삭제(응답 함께, 문의는 연결만 끊김), 건수를 NOTICE로 보고, 제약 validate·not null. 두 번째는 0건', async () => {
  const notices = await applyAsOwner(cleanup);
  expect(notices).toEqual(['diagnosis consent cleanup: results_deleted=4 (member=2, nonmember=2), answers_deleted=120, leads_unlinked=3']);
  expect(await q('select respondent_name from diagnosis_results')).toEqual([{ respondent_name: '새사람' }]);
  expect(Number((await q('select count(*) c from diagnosis_answers'))[0].c)).toBe(30);
  expect(await q('select id, result_id from diagnosis_leads order by name')).toEqual([
    { id: legacy.claimedGuestLead, result_id: null },
    { id: legacy.guestLead, result_id: null },
    { id: legacy.memberLead, result_id: null },
  ]);
  expect(await q("select convalidated from pg_constraint where conname = 'diagnosis_results_sensitive_consent_required'")).toEqual([{ convalidated: true }]);
  const col = await q(`select attname, attnotnull from pg_attribute where attrelid = 'diagnosis_results'::regclass and attname like 'sensitive_%' order by 1`);
  expect(col.every((r) => r.attnotnull)).toBe(true);

  expect(await applyAsOwner(cleanup)).toEqual(['diagnosis consent cleanup: results_deleted=0 (member=0, nonmember=0), answers_deleted=0, leads_unlinked=0']);
  expect(await resultCount()).toBe(1);
  // 패치 뒤 claim_diagnosis는 비회원 문의를 묶는다(함수 본문 확인은 rpc-quiz-diagnosis.test.ts)
  expect((await q("select prosrc ~ 'update diagnosis_leads set user_id = v_user_id' ok from pg_proc where proname = 'claim_diagnosis'"))[0].ok).toBe(true);
  // 정리 뒤에 패치를 다시 적용해도 된다(제약 not valid 재생성 없음, 최종 상태 유지)
  await applyAsOwner(patch);
  expect(await q("select convalidated from pg_constraint where conname = 'diagnosis_results_sensitive_consent_required'")).toEqual([{ convalidated: true }]);
});
