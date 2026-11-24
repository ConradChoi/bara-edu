import { afterAll, beforeAll, expect, test } from 'vitest';
import { DEV_ADMIN, DEV_COURSE_SLUG, DEV_LEARNER, isLocalDbUrl, SeedRefused, seedDev } from './helpers/seed-dev.js';
import { setupTestDb } from './helpers/db.js';

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx?.close());

test('개발 시드: 관리자·학습자·강좌·레슨·퀴즈·시험 문항, 다시 실행해도 같은 결과', async () => {
  await seedDev(ctx.adminUrl);
  await seedDev(ctx.adminUrl);
  const roles = await ctx.adminPool.query(
    `select u.email, p.role, u.email_confirmed_at is not null as confirmed from auth.users u join profiles p on p.id = u.id order by u.email`,
  );
  expect(roles.rows).toEqual([
    { email: DEV_ADMIN.email, role: 'admin', confirmed: true },
    { email: DEV_LEARNER.email, role: 'learner', confirmed: true },
  ]);
  const counts = await ctx.adminPool.query(`
    select (select count(*)::int from courses where slug = '${DEV_COURSE_SLUG}') as courses,
           (select count(*)::int from lessons) as lessons,
           (select count(*)::int from quiz_options) as quiz_options,
           (select count(*)::int from course_exam_question_links) as exam_links,
           (select count(*)::int from bank_accounts) as bank_accounts`);
  expect(counts.rows[0]).toEqual({ courses: 1, lessons: 1, quiz_options: 2, exam_links: 1, bank_accounts: 1 });
});

test('로컬이 아닌 DB 주소면 접속 전에 거절', async () => {
  for (const url of [
    'postgres://u:p@db.example.com:5432/x',
    'postgres://u:p@localhost.example.com/x',
    'postgres://u:p@10.0.0.5/x',
    'not a url',
    'postgres://u:p@localhost/x?host=evil.com',
    'postgres://u:p@localhost/x?hostaddr=1.2.3.4',
    'postgres://u:p@localhost/x?service=x',
    'postgres://u:p@localhost/x?host=/tmp',
    'postgres:///x',
  ]) {
    expect(isLocalDbUrl(url)).toBe(false);
  }
  for (const url of ['postgres://u:p@localhost:54329/x', 'postgres://u:p@127.0.0.1/x', 'postgres://u:p@[::1]:5432/x', 'postgres://u:p@localhost/x?hostaddr=127.0.0.1']) {
    expect(isLocalDbUrl(url)).toBe(true);
  }
  for (const url of ['postgres://u:secret@db.example.com:5432/x', 'postgres://u:secret@localhost:54329/x?host=evil.example.com']) {
    const err = await seedDev(url).catch((e) => e);
    expect(err).toBeInstanceOf(SeedRefused);
    expect(err.message).not.toMatch(/secret|example/);
  }
});

test('@dev.local이 아닌 회원이 있는 DB면 거절하고 아무것도 쓰지 않는다', async () => {
  const other = await setupTestDb();
  try {
    await other.adminPool.query("insert into auth.users (email) values ('real@example.com')");
    const err = await seedDev(other.adminUrl).catch((e) => e);
    expect(err).toBeInstanceOf(SeedRefused);
    expect(err.message).not.toMatch(/real@example/);
    const r = await other.adminPool.query('select count(*)::int as n from courses');
    expect(r.rows[0].n).toBe(0);
  } finally {
    await other.close();
  }
});

test('이메일이 NULL인 회원도 개발용이 아닌 것으로 보고 거절', async () => {
  const other = await setupTestDb();
  try {
    await other.adminPool.query('alter table auth.users alter column email drop not null');
    await other.adminPool.query(`insert into auth.users (email, raw_user_meta_data) values (null, '{"name":"이름"}')`);
    const err = await seedDev(other.adminUrl).catch((e) => e);
    expect(err).toBeInstanceOf(SeedRefused);
    const r = await other.adminPool.query('select count(*)::int as n from courses');
    expect(r.rows[0].n).toBe(0);
  } finally {
    await other.close();
  }
});
