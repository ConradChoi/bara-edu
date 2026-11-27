import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setupTestDb } from './helpers/db.js';
import { addUser } from './helpers/mfa.js';

// 정식 오픈 1회용 스크립트(api/db/oneoff/2026-11-27-launch-v1.cjs)와 보관 패치(2026-11-27-legal-prelaunch-archive.sql).
const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, '..', 'db', 'oneoff', '2026-11-27-launch-v1.cjs');
const PATCH = path.join(here, '..', 'db', 'patches', '2026-11-27-legal-prelaunch-archive.sql');
const BODIES = path.join(here, '..', '..', 'docs', 'legal', 'v1.0');
const run = promisify(execFile);
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let url: string;
const q = async (sql: string, p: unknown[] = []) => (await ctx.adminPool.query(sql, p)).rows;

beforeAll(async () => {
  ctx = await setupTestDb();
  const u = new URL((ctx.pool as unknown as { options: { connectionString: string } }).options.connectionString);
  u.searchParams.set('sslmode', 'disable');
  url = u.toString();
  const patch = await readFile(PATCH, 'utf8');
  await q(`begin; set local role bara_edu_service; ${patch}; commit;`);
  await q(`begin; set local role bara_edu_service; ${patch}; commit;`); // 멱등
  // 운영과 같은 모양: privacy 10행(게시본 10), terms 1, refund-policy 1, 수료증 1, 문의 1, 동의 기록 v10 결과 1
  for (let v = 1; v <= 10; v++) {
    await q("insert into legal_documents (type, slug, title, content, version, is_published, published_at) values ('privacy','privacy','개인정보처리방침',$1,$2,$3, now())", [`privacy v${v}`, v, v === 10]);
  }
  await q("insert into legal_documents (type, slug, title, content, version, is_published, published_at, effective_at) values ('terms','terms','이용약관','terms v1',1,true,'2026-08-06','2026-08-06'), ('refund_policy','refund-policy','환불정책','refund v1',1,true,'2026-09-16','2026-09-16')");
  const admin = await addUser(ctx, { admin: true });
  void admin;
  const learner = await addUser(ctx);
  const course = (await q("insert into courses (title, slug) values ('c','c-launch') returning id"))[0].id;
  await q('insert into certificates (user_id, course_id) values ($1,$2)', [learner.id, course]);
  const rid = (
    await q(
      `insert into diagnosis_results (user_id, respondent_name, phone, email, learning_experience, age_confirmed, version, score_theory, score_reading, score_analysis, score_counseling, score_case_record, score_teaching, total_score, recommended_tier, consent_privacy, consent_privacy_doc_version, sensitive_consent_version, sensitive_consented_at, strength_areas, improvement_areas)
       select null,'n','010-1111-2222',null, e, true, 'v1', 1,2,3,4,5,6, 10, t, true, 10, 'sc-v1', '2026-11-26T13:30:00Z', array['theory'], array['teaching'] from (select (enum_range(null::diagnosis_experience))[1] e, (enum_range(null::diagnosis_tier))[1] t) s returning id`,
    )
  )[0].id;
  await q("insert into diagnosis_leads (result_id, name, contact, consent_contact) values ($1,'guest','g@x.kr',true)", [rid]);
});
afterAll(async () => {
  await ctx.close();
});

const script = (...args: string[]) => run('node', [SCRIPT, BODIES, ...args], { env: { ...process.env, DATABASE_URL: url } });
const snapshot = async () => ({
  docs: await q('select slug, version, is_published, content from legal_documents order by slug, version'),
  certs: (await q('select count(*)::int n from certificates'))[0].n,
  leads: (await q('select count(*)::int n from diagnosis_leads'))[0].n,
  archive: (await q('select count(*)::int n from archive.legal_documents_prelaunch'))[0].n,
  logs: (await q("select count(*)::int n from admin_access_logs where action = '오픈전정리삭제'"))[0].n,
});

test('보관 스키마는 웹 역할이 쓸 수 없다(usage 없음)', async () => {
  const r = await q("select has_schema_privilege('bara_edu_anon','archive','usage') a, has_schema_privilege('bara_edu_authenticated','archive','usage') b");
  expect(r[0]).toEqual({ a: false, b: false });
});

test('기본(확인만): 모든 단계를 한 뒤 되돌려 DB가 그대로다', async () => {
  const before = await snapshot();
  const r = await script();
  expect(r.stdout).toContain('ROLLED BACK (dry-run)');
  const out = JSON.parse(r.stdout.split('\n')[0]);
  expect(out).toMatchObject({ mode: 'dry-run', archived: 12, accessLogs: 2, legal: ['privacy:v1.0', 'refund-policy:v1.0', 'terms:v1.0'], diagnosisResultsConsentV10Kept: 1 });
  expect(await snapshot()).toEqual(before);
});

test('--execute: 원문 12행 보관, 수료증·문의 삭제와 기록 2건, 세 문서 v1 한 행씩 게시(v1.0 본문), 동의 기록 v10 유지. 다시 실행하면 거절', async () => {
  const r = await script('--execute');
  expect(r.stdout).toContain('COMMITTED');
  const s = await snapshot();
  expect(s).toMatchObject({ certs: 0, leads: 0, archive: 12, logs: 2 });
  expect(s.docs.map((d) => [d.slug, d.version, d.is_published])).toEqual([['privacy', 1, true], ['refund-policy', 1, true], ['terms', 1, true]]);
  for (const d of s.docs) expect(d.content).toBe(await readFile(path.join(BODIES, `${d.slug}.txt`), 'utf8'));
  expect(await q("select version, is_published from archive.legal_documents_prelaunch where slug = 'privacy' order by version")).toHaveLength(10);
  expect(await q("select content from archive.legal_documents_prelaunch where slug = 'terms'")).toEqual([{ content: 'terms v1' }]);
  expect((await q('select consent_privacy_doc_version v from diagnosis_results'))[0].v).toBe(10);
  const details = (await q("select detail, target_user_id from admin_access_logs where action = '오픈전정리삭제' order by detail")).map((x) => x.detail);
  expect(details[0]).toMatch(/^by=db;operator=개발;reason=launch_cleanup;table=certificates;id=[0-9a-f-]{36};fields=row$/);
  expect(details[1]).toMatch(/^by=db;operator=개발;reason=launch_cleanup;table=diagnosis_leads;id=[0-9a-f-]{36};fields=row$/);
  for (const d of details) expect(d).not.toMatch(/guest|g@x\.kr|010-/);
  // 다시 실행: 기대 건수가 맞지 않아 아무것도 바꾸지 않고 실패
  await expect(script('--execute')).rejects.toMatchObject({ stderr: expect.stringContaining('FAILED, rolled back: expected 1 certificates, found 0') });
  expect(await snapshot()).toEqual(s);
});
