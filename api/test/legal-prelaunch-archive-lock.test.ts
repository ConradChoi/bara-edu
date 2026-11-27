import { afterAll, beforeAll, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb } from './helpers/db.js';

// 오픈 전 원문 보관 테이블 잠금 패치(api/db/patches/2026-11-27-legal-prelaunch-archive-lock.sql).
const here = path.dirname(fileURLToPath(import.meta.url));
const patch = (f: string) => readFile(path.join(here, '..', 'db', 'patches', f), 'utf8');
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
const q = async (sql: string, p: unknown[] = []) => (await ctx.adminPool.query(sql, p)).rows;
// 연결 하나에서 트랜잭션을 열고, 실패하면 그 연결에서 롤백한다(중단된 트랜잭션이 풀로 돌아가지 않게).
const asService = async (sql: string) => {
  const c = await ctx.adminPool.connect();
  try {
    await c.query('begin');
    await c.query('set local role bara_edu_service');
    const r = await c.query(sql);
    await c.query('commit');
    return r;
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
};
const ROW = `insert into archive.legal_documents_prelaunch (id, type, slug, title, content, version, is_published, effective_at, created_at, published_at, archive_reason)
  values (gen_random_uuid(), 'privacy', 'privacy', 't', 'c', 1, true, now(), now(), now(), 'launch_v1')`;

beforeAll(async () => {
  ctx = await setupTestDb();
  await asService(await patch('2026-11-27-legal-prelaunch-archive.sql'));
  await asService(ROW); // 잠그기 전 원문 복사
  const lock = await patch('2026-11-27-legal-prelaunch-archive-lock.sql');
  await asService(lock);
  await asService(lock); // 멱등
});
afterAll(async () => {
  await ctx.close();
});

test('소유 역할에는 select만 남는다', async () => {
  const r = await q(`select ${['select', 'insert', 'update', 'delete', 'truncate']
    .map((p) => `has_table_privilege('bara_edu_service','archive.legal_documents_prelaunch','${p}') "${p}"`)
    .join(', ')}`);
  expect(r[0]).toEqual({ select: true, insert: false, update: false, delete: false, truncate: false });
  expect(await asService('select count(*)::int n from archive.legal_documents_prelaunch')).toBeDefined();
  expect((await q('select count(*)::int n from archive.legal_documents_prelaunch'))[0].n).toBe(1);
});

test.each([
  ['insert', ROW],
  ['update', "update archive.legal_documents_prelaunch set content = 'x'"],
  ['delete', 'delete from archive.legal_documents_prelaunch'],
  ['truncate', 'truncate archive.legal_documents_prelaunch'],
])('소유 역할의 %s는 권한 없음으로 거절', async (_op, sql) => {
  await expect(asService(sql)).rejects.toMatchObject({ code: '42501' });
});

test.each([
  ['INSERT', ROW],
  ['UPDATE', "update archive.legal_documents_prelaunch set content = 'x'"],
  ['DELETE', 'delete from archive.legal_documents_prelaunch where false'],
  ['TRUNCATE', 'truncate archive.legal_documents_prelaunch'],
])('권한을 다시 줘도(또는 관리자 계정도) %s는 트리거가 막는다', async (op, sql) => {
  await expect(q(sql)).rejects.toMatchObject({ code: '42501', message: `archive.legal_documents_prelaunch is read-only (${op} blocked)` });
  await asService('grant insert, update, delete, truncate on archive.legal_documents_prelaunch to bara_edu_service');
  try {
    await expect(asService(sql)).rejects.toMatchObject({ message: `archive.legal_documents_prelaunch is read-only (${op} blocked)` });
  } finally {
    await asService('revoke insert, update, delete, truncate on archive.legal_documents_prelaunch from bara_edu_service');
  }
  expect((await q("select count(*)::int n from archive.legal_documents_prelaunch where content = 'c'"))[0].n).toBe(1);
});
