import { afterAll, beforeAll, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { isSameDatabase, migrate, type PhotoDownloader } from '../scripts/migrate-from-supabase.js';
import { setupTestDb } from './helpers/db.js';

type Db = Awaited<ReturnType<typeof setupTestDb>>;
const KEY = 'k'.repeat(32);
const PASSWORD = 'old-supabase-pw-1';
const ids = {
  admin: 'a0000000-0000-4000-8000-000000000001',
  learner: 'a0000000-0000-4000-8000-000000000002',
  unconfirmed: 'a0000000-0000-4000-8000-000000000003',
  noHash: 'a0000000-0000-4000-8000-000000000004',
  root: 'c0000000-0000-4000-8000-000000000001',
  child: 'c0000000-0000-4000-8000-000000000002',
  course: 'c0000000-0000-4000-8000-000000000003',
  lesson: 'c0000000-0000-4000-8000-000000000004',
  diag: 'c0000000-0000-4000-8000-000000000005',
};
const EMAIL = { admin: 'Admin@Bara-Edu.kr', learner: 'learner@bara-edu.kr', unconfirmed: 'pending@bara-edu.kr', noHash: 'nohash@bara-edu.kr' };

let source: Db;
const targets: Db[] = [];
let hash2a: string;

async function newTarget(): Promise<Db> {
  const t = await setupTestDb();
  targets.push(t);
  return t;
}

async function run(target: Db, extra: Partial<Parameters<typeof migrate>[0]> = {}) {
  const lines: string[] = [];
  const code = await migrate({ sourceUrl: source.adminUrl, targetUrl: target.adminUrl, log: (l) => lines.push(l), batchSize: 2, ...extra });
  return { code, lines };
}

// Supabase auth.users carries more columns than the ported table and allows a null email
async function makeSupabaseLike(db: Db): Promise<void> {
  await db.adminPool.query(`
    alter table auth.users
      add column instance_id uuid,
      add column aud varchar(255),
      add column role varchar(255),
      add column raw_app_meta_data jsonb,
      add column last_sign_in_at timestamptz,
      add column phone text,
      add column is_anonymous boolean not null default false,
      alter column email drop not null;
    drop index auth.users_email_lower_key;`);
}

async function seedSource(db: Db): Promise<void> {
  const users: [string, string, string | null, boolean, object][] = [
    [ids.admin, EMAIL.admin, hash2a, true, { name: '관리자', phone: '010-1111-1111' }],
    [ids.learner, EMAIL.learner, hash2a, true, { name: '학습자' }],
    [ids.unconfirmed, EMAIL.unconfirmed, hash2a, false, { name: '미인증' }],
    [ids.noHash, EMAIL.noHash, null, true, {}],
  ];
  for (const [id, email, hash, confirmed, meta] of users) {
    await db.adminPool.query(
      `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, instance_id, aud, role, raw_app_meta_data, last_sign_in_at)
       values ($1, $2, $3, $4, $5, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{"provider":"email"}', now())`,
      [id, email, hash, confirmed ? new Date('2026-09-01T01:02:03.456789Z') : null, JSON.stringify(meta)],
    );
  }
  await db.adminPool.query(`
    begin;
    set local session_replication_role = replica;
    update profiles set role = 'admin', name = '대표 관리자' where id = '${ids.admin}';
    update profiles set photo_path = id::text || '/photo', address = '서울' where id = '${ids.learner}';
    update profiles set photo_path = id::text || '/avatar.png' where id = '${ids.unconfirmed}';
    insert into categories (id, name, parent_id, depth) values ('${ids.root}', '도형심리', null, 1), ('${ids.child}', '1급', '${ids.root}', 2);
    insert into courses (id, slug, title, category_id, fee, status) values ('${ids.course}', 'shape-test-analysis-1', '1급 과정', '${ids.child}', 300000, 'active');
    insert into lessons (id, course_id, title) values ('${ids.lesson}', '${ids.course}', '1강');
    insert into enrollments (user_id, course_id, status) values ('${ids.learner}', '${ids.course}', 'approved'), ('${ids.unconfirmed}', '${ids.course}', 'pending');
    insert into progress (user_id, lesson_id, completed_at) values ('${ids.learner}', '${ids.lesson}', now());
    insert into certificates (user_id, course_id) values ('${ids.learner}', '${ids.course}');
    insert into course_exam_submissions (user_id, course_id, score, passed, attempt_no) values ('${ids.learner}', '${ids.course}', 50, false, 1), ('${ids.learner}', '${ids.course}', 90, true, 2);
    insert into admin_access_logs (admin_id, target_user_id, action) values ('${ids.admin}', '${ids.learner}', '조회');
    insert into diagnosis_results (id, user_id, learning_experience, age_confirmed, version, score_theory, score_reading, score_analysis,
                                   score_counseling, score_case_record, score_teaching, total_score, recommended_tier, strength_areas, consent_privacy)
      values ('${ids.diag}', '${ids.learner}', 'none', true, 'v1', 1, 2, 3, 4, 5, 6, 87.25, 'level1', '{theory,"reading, deep"}', true);
    insert into diagnosis_answers (result_id, item_code, score) values ('${ids.diag}', 'T1', 3), ('${ids.diag}', 'T2', 4);
    update diagnosis_course_links set course_id = '${ids.course}', cta_label = '운영에서 고친 문구' where tier = 'level1';
    commit;`);
}

async function publicTables(db: Db): Promise<string[]> {
  const r = await db.adminPool.query<{ t: string }>(`select tablename as t from pg_tables where schemaname = 'public' order by 1`);
  return r.rows.map((x) => x.t);
}

const dump = async (db: Db, sql: string) => JSON.stringify((await db.adminPool.query(sql)).rows);

beforeAll(async () => {
  hash2a = (await bcrypt.hash(PASSWORD, 10)).replace(/^\$2b\$/, '$2a$');
  source = await setupTestDb();
  await makeSupabaseLike(source);
  await seedSource(source);
}, 60_000);

afterAll(async () => {
  for (const t of targets) await t.close();
  await source?.close();
});

test('이관 후 테이블별 건수·체크섬 일치, exit 0', async () => {
  const target = await newTarget();
  const { code, lines } = await run(target);
  expect(code, lines.join('\n')).toBe(0);
  expect(lines).toContain('migration done');
  expect(lines).toContain('password hashes: $2a$=3 $2b$=0 other=1 (password_reset_required on login: 1)');
  expect(lines.some((l) => l.includes('MISMATCH'))).toBe(false);
  for (const t of ['profiles', 'enrollments', 'certificates', 'course_exam_submissions', 'diagnosis_results']) {
    expect(lines).toContain(`checksum ${t}: match`);
  }

  for (const t of await publicTables(source)) {
    expect(await dump(target, `select * from public."${t}" order by 1, 2`), t).toBe(await dump(source, `select * from public."${t}" order by 1, 2`));
  }
  const userCols = 'id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data';
  expect(await dump(target, `select ${userCols} from auth.users order by id`)).toBe(await dump(source, `select ${userCols} from auth.users order by id`));
  const diag = await target.adminPool.query(`select total_score::text, strength_areas from diagnosis_results`);
  expect(diag.rows[0]).toEqual({ total_score: '87.25', strength_areas: ['theory', 'reading, deep'] });
  const link = await target.adminPool.query(`select course_id, cta_label from diagnosis_course_links where tier = 'level1'`);
  expect(link.rows[0]).toEqual({ course_id: ids.course, cta_label: '운영에서 고친 문구' });

  const out = lines.join('\n');
  expect(out).not.toContain('@');
  expect(out).not.toContain(hash2a);
  expect(out).not.toContain('postgres:');
});

test('이관된 $2a$ 해시 계정이 기존 비밀번호로 로그인', async () => {
  const target = await newTarget();
  expect((await run(target)).code).toBe(0);
  const stored = await target.adminPool.query<{ encrypted_password: string }>('select encrypted_password from auth.users where id = $1', [ids.admin]);
  expect(stored.rows[0]!.encrypted_password.startsWith('$2a$')).toBe(true);

  const config = loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY });
  const app = buildApp({ config, pool: target.pool, mailer: new MemoryMailer(), storage: new MemoryStorage() });
  await app.ready();
  try {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: EMAIL.admin.toLowerCase(), password: PASSWORD },
      headers: { 'x-bara-service-key': KEY },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().userId).toBe(ids.admin);
    const s = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { 'x-bara-service-key': KEY, 'x-bara-session': r.json().sessionToken } });
    expect(s.json().profile.role).toBe('admin');
  } finally {
    await app.close();
  }
});

test('이관 후 profiles 중복 없음(트리거 미발동)', async () => {
  const target = await newTarget();
  expect((await run(target)).code).toBe(0);
  const r = await target.adminPool.query<{ id: string; n: number }>('select id, count(*)::int as n from profiles group by id order by id');
  expect(r.rows).toEqual([ids.admin, ids.learner, ids.unconfirmed, ids.noHash].sort().map((id) => ({ id, n: 1 })));
  const admin = await target.adminPool.query('select name, phone, role from profiles where id = $1', [ids.admin]);
  expect(admin.rows[0]).toEqual({ name: '대표 관리자', phone: '010-1111-1111', role: 'admin' });
  const learner = await target.adminPool.query('select photo_path from profiles where id = $1', [ids.unconfirmed]);
  expect(learner.rows[0]!.photo_path).toBe(`${ids.unconfirmed}/avatar.png`);
});

test('대상 DB가 비어 있지 않으면 시작 거부', async () => {
  const target = await newTarget();
  await target.adminPool.query(`insert into auth.users (email, encrypted_password) values ('existing@bara-edu.kr', 'x')`);
  const { code, lines } = await run(target);
  expect(code).toBe(1);
  expect(lines).toContain('refused: target is not empty (auth.users, profiles)');
  expect((await target.adminPool.query('select count(*)::int as n from auth.users')).rows[0].n).toBe(1);
  expect((await target.adminPool.query('select count(*)::int as n from enrollments')).rows[0].n).toBe(0);

  const other = await newTarget();
  await other.adminPool.query(`insert into categories (name, depth) values ('x', 1)`);
  expect((await run(other)).lines).toContain('refused: target is not empty (categories)');
});

test('원본과 대상이 같은 DB면 접속 전에 거부', async () => {
  const { code, lines } = await run(source);
  expect(code).toBe(1);
  expect(lines).toEqual(['refused: source and target are the same database']);
  expect(isSameDatabase('postgres://a:b@localhost:5432/x', 'postgresql://c@127.0.0.1/x?sslmode=disable')).toBe(true);
  expect(isSameDatabase('postgres://a@db.example.com:5432/bara_edu', 'postgres://a@DB.example.com/bara_edu')).toBe(true);
  expect(isSameDatabase('postgres://a@db.example.com/bara_edu', 'postgres://a@db.example.com/bara_edu_staging')).toBe(false);
  expect(isSameDatabase('postgres://a@db.example.com:5432/x', 'postgres://a@db.example.com:6543/x')).toBe(false);
});

test('이메일 미인증 계정도 그대로 이관(email_confirmed_at null)', async () => {
  const target = await newTarget();
  const { code, lines } = await run(target);
  expect(code).toBe(0);
  expect(lines).toContain('unconfirmed email: 1');
  const r = await target.adminPool.query('select email, email_confirmed_at from auth.users where id = $1', [ids.unconfirmed]);
  expect(r.rows[0]).toEqual({ email: EMAIL.unconfirmed, email_confirmed_at: null });
});

test('FK가 끊긴 행이 있으면 exit 1, 대상은 비어 있음', async () => {
  const orphanId = 'e0000000-0000-4000-8000-0000000000ff';
  await source.adminPool.query(`begin; set local session_replication_role = replica;
    insert into enrollments (id, user_id, course_id) values ('${orphanId}', 'f0000000-0000-4000-8000-000000000000', '${ids.course}'); commit;`);
  try {
    const target = await newTarget();
    const { code, lines } = await run(target);
    expect(code).toBe(1);
    expect(lines).toContain('orphan rows: enrollments (enrollments_user_id_fkey) 1');
    expect(lines).toContain('target rolled back');
    expect((await target.adminPool.query('select count(*)::int as n from auth.users')).rows[0].n).toBe(0);
  } finally {
    await source.adminPool.query(`delete from enrollments where id = '${orphanId}'`);
  }
});

test('--photos: 원본 photo_path 그대로 S3 키로 업로드, 건수 대조', async () => {
  const objects = new Map([
    [`${ids.learner}/photo`, { body: Buffer.from('jpeg-bytes'), contentType: 'image/jpeg' }],
    [`${ids.unconfirmed}/avatar.png`, { body: Buffer.from('png-bytes'), contentType: 'image/png' }],
  ]);
  const downloader: PhotoDownloader = { download: async (p) => objects.get(p) ?? null };
  const uploader = new MemoryStorage();
  const target = await newTarget();
  const { code, lines } = await run(target, { photos: { downloader, uploader } });
  expect(code, lines.join('\n')).toBe(0);
  expect(lines).toContain('photos: 2 paths, not <uid>/photo: 1, not signable by API: 0');
  expect(lines).toContain('photos: source=2 uploaded=2 missing=0');
  expect([...uploader.objects.keys()].sort()).toEqual([...objects.keys()].sort());
  expect(uploader.objects.get(`${ids.unconfirmed}/avatar.png`)).toEqual(objects.get(`${ids.unconfirmed}/avatar.png`));
});

test('--photos: 원본 객체가 없으면 exit 1, 대상 DB 롤백', async () => {
  const downloader: PhotoDownloader = { download: async (p) => (p.endsWith('/photo') ? { body: Buffer.from('x'), contentType: 'image/jpeg' } : null) };
  const target = await newTarget();
  const { code, lines } = await run(target, { photos: { downloader, uploader: new MemoryStorage() } });
  expect(code).toBe(1);
  expect(lines).toContain('photos: source=2 uploaded=1 missing=1');
  expect((await target.adminPool.query('select count(*)::int as n from profiles')).rows[0].n).toBe(0);
});

test('원본에 대상에 없는 열이 있으면 시작하지 않음', async () => {
  await source.adminPool.query('alter table public.categories add column legacy_flag boolean');
  try {
    const target = await newTarget();
    const { code, lines } = await run(target);
    expect(code).toBe(1);
    expect(lines).toContain('source columns missing in target: categories.legacy_flag');
  } finally {
    await source.adminPool.query('alter table public.categories drop column legacy_flag');
  }
});
