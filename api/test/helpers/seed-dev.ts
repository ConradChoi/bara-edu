// 로컬 통합 확인용 시드. 운영·리허설 DB에는 쓰지 않는다(고정 개발용 계정·비밀번호).
// 실행: DATABASE_ADMIN_URL=... npm run db:seed-dev  (여러 번 실행해도 같은 결과)
import bcrypt from 'bcryptjs';
import pg from 'pg';

export const DEV_ADMIN = { email: 'admin@dev.local', password: 'dev-admin-pass-1', name: '개발관리자' };
export const DEV_LEARNER = { email: 'learner@dev.local', password: 'dev-learner-pass-1', name: '개발학습자' };

const ID = {
  category: 'd0000000-0000-0000-0000-000000000001',
  course: 'd0000000-0000-0000-0000-000000000002',
  lesson: 'd0000000-0000-0000-0000-000000000003',
  quizQuestion: 'd0000000-0000-0000-0000-000000000004',
  quizRight: 'd0000000-0000-0000-0000-000000000005',
  quizWrong: 'd0000000-0000-0000-0000-000000000006',
  examQuestion: 'd0000000-0000-0000-0000-000000000007',
  examRight: 'd0000000-0000-0000-0000-000000000008',
  examWrong: 'd0000000-0000-0000-0000-000000000009',
  bankAccount: 'd0000000-0000-0000-0000-00000000000a',
};
export const DEV_COURSE_SLUG = 'dev-shape-course';

async function upsertUser(db: pg.Client, u: { email: string; password: string; name: string }): Promise<string> {
  const hash = await bcrypt.hash(u.password, 10);
  const found = await db.query<{ id: string }>('select id from auth.users where lower(email) = lower($1)', [u.email]);
  if (found.rows[0]) {
    await db.query('update auth.users set encrypted_password = $2, email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1', [found.rows[0].id, hash]);
    return found.rows[0].id;
  }
  const r = await db.query<{ id: string }>(
    `insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
     values ($1, $2, now(), jsonb_build_object('name', $3::text)) returning id`,
    [u.email, hash, u.name],
  );
  return r.rows[0].id;
}

export async function seedDev(adminUrl: string): Promise<void> {
  const db = new pg.Client({ connectionString: adminUrl });
  await db.connect();
  try {
    const adminId = await upsertUser(db, DEV_ADMIN);
    await upsertUser(db, DEV_LEARNER);
    // protect_profile_privileged_columns가 관리자 아닌 세션의 role 변경을 되돌리므로 트리거를 끄고 바꾼다.
    await db.query(`begin; set local session_replication_role = replica; update profiles set role = 'admin' where id = '${adminId}'; commit`);

    await db.query('begin');
    await db.query(
      `insert into categories (id, name, parent_id, depth, "order", is_certification) values ($1, '도형심리(개발용)', null, 1, 99, true)
       on conflict (id) do nothing`,
      [ID.category],
    );
    await db.query(
      `insert into courses (id, slug, title, category_id, description, instructor, fee, seats, status,
                            requires_certificate_info, requires_exam, exam_pass_score, exam_max_attempts)
       values ($1, $2, '도형심리 개발용 과정', $3, '로컬 통합 확인용 강좌', '개발강사', 1000, 10, 'active', true, true, 60, 3)
       on conflict (id) do nothing`,
      [ID.course, DEV_COURSE_SLUG, ID.category],
    );
    await db.query(
      `insert into lessons (id, course_id, title, video_url, "order", has_quiz)
       values ($1, $2, '1강 개요', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 1, true)
       on conflict (id) do nothing`,
      [ID.lesson, ID.course],
    );
    await db.query(`insert into quiz_questions (id, lesson_id, question, "order") values ($1, $2, '개발용 퀴즈 문항', 1) on conflict (id) do nothing`, [
      ID.quizQuestion,
      ID.lesson,
    ]);
    await db.query(
      `insert into quiz_options (id, question_id, label, is_correct, "order") values ($1, $3, '정답', true, 1), ($2, $3, '오답', false, 2)
       on conflict (id) do nothing`,
      [ID.quizRight, ID.quizWrong, ID.quizQuestion],
    );
    await db.query(
      `insert into exam_question_bank (id, category_id, question, "order") values ($1, $2, '개발용 시험 문항', 1) on conflict (id) do nothing`,
      [ID.examQuestion, ID.category],
    );
    await db.query(
      `insert into exam_bank_options (id, bank_question_id, label, is_correct, "order") values ($1, $3, '정답', true, 1), ($2, $3, '오답', false, 2)
       on conflict (id) do nothing`,
      [ID.examRight, ID.examWrong, ID.examQuestion],
    );
    await db.query(
      `insert into course_exam_question_links (course_id, bank_question_id, "order") values ($1, $2, 1)
       on conflict (course_id, bank_question_id) do nothing`,
      [ID.course, ID.examQuestion],
    );
    await db.query(
      `insert into bank_accounts (id, bank_name, account_number, account_holder, "order") values ($1, '개발은행', '000-0000-0000', '바라평생교육원', 1)
       on conflict (id) do nothing`,
      [ID.bankAccount],
    );
    await db.query('commit');
  } catch (err) {
    await db.query('rollback').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) {
    console.error('DATABASE_ADMIN_URL is required');
    process.exit(1);
  }
  seedDev(adminUrl).then(
    () => console.log('db:seed-dev done'),
    (err: { code?: string; message?: string }) => {
      console.error('db:seed-dev failed', err?.code ?? '', err?.message ?? '');
      process.exit(1);
    },
  );
}
