import { afterAll, beforeAll, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb } from './helpers/db.js';

// 가입 시도 테이블 패치(2026-11-25). R24 패치 테스트(함수만 담는 패치)와 달리 테이블·컬럼·인덱스 생성과 데이터 이행을 담으므로
// 형식 검사 규칙(문장 종류 허용 목록, 역할 전환 금지)을 이 패치에 맞게 따로 둔다.
const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');
const PATCH = path.join(dbDir, 'patches', '2026-11-25-signup-attempts.sql');
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let patch: string;
let schema: string;
let auth: string;

beforeAll(async () => {
  ctx = await setupTestDb();
  patch = await readFile(PATCH, 'utf8');
  schema = await readFile(path.join(dbDir, '02-schema.sql'), 'utf8');
  auth = await readFile(path.join(dbDir, '01-auth.sql'), 'utf8');
});
afterAll(async () => {
  await ctx.close();
});

const skeleton = () => {
  const noComments = patch.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  return noComments.replace(/\$\$[\s\S]*?\$\$/g, '$$$$');
};
const statements = () => skeleton().split(';').map((s) => s.trim()).filter(Boolean);

test('패치 형식: 허용된 문장만(create ... if not exists, alter add column if not exists, create or replace function, 이행용 update·delete)', () => {
  const allowed = [
    /^create table if not exists auth\.signup_attempts\b/,
    /^create index if not exists \w+ on auth\./,
    /^alter table auth\.email_tokens add column if not exists attempt_id\b/,
    /^create or replace function public\.purge_unverified_signups\(\)/,
    /^update auth\.users set encrypted_password = null\b/,
    /^delete from auth\.email_tokens\b/,
  ];
  for (const st of statements()) expect(allowed.some((re) => re.test(st)), st).toBe(true);
  expect(skeleton()).not.toMatch(/\b(drop|truncate|grant|revoke)\b/i);
  expect(skeleton()).not.toMatch(/\bset\s+(local\s+)?role\b/i);
  expect(skeleton()).not.toMatch(/\b(begin|commit)\b/i);
});

test('패치의 테이블 정의와 함수 정의는 스키마 파일과 글자 그대로 같다 (둘이 어긋나지 않게)', () => {
  const table = (sql: string) => {
    const a = sql.indexOf('create table if not exists auth.signup_attempts');
    return sql.slice(a, sql.indexOf('\n);', a) + 3);
  };
  expect(table(patch)).toBe(table(auth));
  const fn = (sql: string) => {
    const a = sql.indexOf('create or replace function public.purge_unverified_signups()');
    return sql.slice(a, sql.indexOf('\n$$;', a) + 4);
  };
  expect(fn(patch)).toBe(fn(schema));
  for (const idx of ['signup_attempts_user_created_idx', 'signup_attempts_expires_idx', 'email_tokens_attempt_idx', 'email_tokens_user_idx']) {
    expect(patch, idx).toContain(idx);
    expect(auth, idx).toContain(idx);
  }
});

const run = async () => {
  const c = await ctx.adminPool.connect();
  try {
    await c.query('begin'); // 운영 적용 방식: begin; set local role bara_edu_service; <파일>; commit;
    await c.query('set local role bara_edu_service');
    await c.query(patch);
    await c.query('commit');
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
};
const q = async (sql: string, p: unknown[] = []) => (await ctx.adminPool.query(sql, p)).rows;

test('옛 스키마(새 객체 없음)에 적용: 객체가 생기고 소유자는 bara_edu_service, 여러 번 실행해도 같다 + 미인증 계정 이행', async () => {
  // 패치 이전 상태를 만든다
  await q('drop table auth.signup_attempts cascade'); // email_tokens.attempt_id 외래키도 함께 사라진다
  await q('alter table auth.email_tokens drop column if exists attempt_id');
  const old = (await q("insert into auth.users (email, encrypted_password) values ('legacy-unconfirmed@x.kr', 'hash') returning id"))[0].id;
  const ok = (await q("insert into auth.users (email, encrypted_password, email_confirmed_at) values ('legacy-ok@x.kr', 'hash2', now()) returning id"))[0].id;
  await q("insert into auth.email_tokens (token_hash, user_id, purpose, expires_at) values ('t-old', $1, 'confirm', now() + interval '1 hour'), ('t-rec', $1, 'recovery', now() + interval '1 hour'), ('t-ok', $2, 'confirm', now() + interval '1 hour')", [old, ok]);

  await run();
  const snapshot = async () => ({
    cols: await q("select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'auth' and table_name in ('signup_attempts', 'email_tokens') order by table_name, column_name"),
    idx: await q("select indexname from pg_indexes where schemaname = 'auth' order by indexname"),
    owner: await q("select relowner::regrole::text as o from pg_class where oid = 'auth.signup_attempts'::regclass"),
  });
  const first = await snapshot();
  expect(first.owner[0].o).toBe('bara_edu_service');
  expect(first.cols.some((c) => c.column_name === 'attempt_id')).toBe(true);
  await run();
  await run();
  expect(await snapshot()).toEqual(first);

  // 이행: 미인증 계정의 비밀번호는 비고, 옛 confirm 토큰은 사라진다. 인증 완료 계정과 recovery 토큰은 그대로
  expect((await q('select encrypted_password from auth.users where id = $1', [old]))[0].encrypted_password).toBeNull();
  expect((await q('select encrypted_password from auth.users where id = $1', [ok]))[0].encrypted_password).toBe('hash2');
  expect((await q('select token_hash from auth.email_tokens order by token_hash')).map((r) => r.token_hash)).toEqual(['t-ok', 't-rec']);
});

test('패치를 다시 실행해도 새 방식의 시도·토큰·비밀번호 없는 계정은 건드리지 않는다', async () => {
  const id = (await q("insert into auth.users (email) values ('new-style@x.kr') returning id"))[0].id;
  const att = (await q("insert into auth.signup_attempts (user_id, password_hash, name) values ($1, 'h', 'n') returning id", [id]))[0].id;
  await q("insert into auth.email_tokens (token_hash, user_id, purpose, expires_at, attempt_id) values ('t-new', $1, 'confirm', now() + interval '1 hour', $2)", [id, att]);
  await run();
  expect(await q('select 1 from auth.email_tokens where token_hash = $1', ['t-new'])).toHaveLength(1);
  expect(await q('select 1 from auth.signup_attempts where id = $1', [att])).toHaveLength(1);
});

test('패치와 API 배포 사이에 옛 API가 받은 가입은 API 배포 직후 두 번째 적용으로 이행된다 (새 방식 데이터·인증된 회원은 그대로)', async () => {
  await run(); // 1차 적용(API 배포 전)
  // 옛 API가 받은 가입: 비밀번호가 users에 있고, 토큰에 attempt_id가 없다
  const legacy = (await q("insert into auth.users (email, encrypted_password) values ('window-legacy@x.kr', 'oldhash') returning id"))[0].id;
  await q("insert into auth.email_tokens (token_hash, user_id, purpose, expires_at) values ('t-window', $1, 'confirm', now() + interval '1 hour')", [legacy]);
  // 새 API가 받은 가입과 인증된 회원
  const fresh = (await q("insert into auth.users (email) values ('window-new@x.kr') returning id"))[0].id;
  const att = (await q("insert into auth.signup_attempts (user_id, password_hash, name) values ($1, 'h', 'n') returning id", [fresh]))[0].id;
  await q("insert into auth.email_tokens (token_hash, user_id, purpose, expires_at, attempt_id) values ('t-window-new', $1, 'confirm', now() + interval '1 hour', $2)", [fresh, att]);
  const ok = (await q("insert into auth.users (email, encrypted_password, email_confirmed_at) values ('window-ok@x.kr', 'okhash', now()) returning id"))[0].id;
  await q("insert into auth.email_tokens (token_hash, user_id, purpose, expires_at) values ('t-window-ok', $1, 'confirm', now() + interval '1 hour')", [ok]);

  await run(); // API 배포 직후 2차 적용
  await run(); // 한 번 더 실행해도 같다
  expect((await q('select encrypted_password from auth.users where id = $1', [legacy]))[0].encrypted_password).toBeNull();
  expect(await q("select 1 from auth.email_tokens where token_hash = 't-window'")).toHaveLength(0);
  expect(await q("select 1 from auth.email_tokens where token_hash = 't-window-new' and attempt_id = $1", [att])).toHaveLength(1);
  expect((await q('select encrypted_password from auth.users where id = $1', [ok]))[0].encrypted_password).toBe('okhash');
  expect(await q("select 1 from auth.email_tokens where token_hash = 't-window-ok'")).toHaveLength(1);
});

test('패치 파일의 add column·인덱스 구문은 한 번씩만 있다', () => {
  for (const re of [/add column if not exists attempt_id/g, /create index if not exists email_tokens_attempt_idx/g, /create index if not exists email_tokens_user_idx/g, /create table if not exists auth\.signup_attempts/g]) {
    expect(patch.match(re), String(re)).toHaveLength(1);
  }
});

test('purge_unverified_signups: 만료된 시도만 지우고 토큰 행은 남긴다 (attempt_id만 비워짐)', async () => {
  const id = (await q("insert into auth.users (email) values ('purge-att@x.kr') returning id"))[0].id;
  const live = (await q("insert into auth.signup_attempts (user_id, password_hash, name) values ($1, 'h', 'n') returning id", [id]))[0].id;
  const dead = (await q("insert into auth.signup_attempts (user_id, password_hash, name, expires_at) values ($1, 'h', 'n', now() - interval '1 second') returning id", [id]))[0].id;
  await q("insert into auth.email_tokens (token_hash, user_id, purpose, expires_at, attempt_id) values ('t-dead', $1, 'confirm', now() + interval '1 hour', $2)", [id, dead]);
  await q('select public.purge_unverified_signups()');
  expect((await q('select id from auth.signup_attempts where user_id = $1', [id])).map((r) => r.id)).toEqual([live]);
  expect((await q("select attempt_id from auth.email_tokens where token_hash = 't-dead'"))[0].attempt_id).toBeNull();
});
