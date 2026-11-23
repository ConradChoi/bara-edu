import { afterAll, beforeAll, expect, test } from 'vitest';
import { DEV_ADMIN, DEV_COURSE_SLUG, DEV_LEARNER, seedDev } from './helpers/seed-dev.js';
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
