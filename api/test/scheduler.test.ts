import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { runJob, startScheduler } from '../src/jobs/scheduler.js';
import { setupTestDb } from './helpers/db.js';

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
const logs: { level: string; obj: unknown; msg?: string }[] = [];
const log = {
  info: (obj: unknown, msg?: string) => logs.push({ level: 'info', obj, msg }),
  error: (obj: unknown, msg?: string) => logs.push({ level: 'error', obj, msg }),
};

beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  logs.length = 0;
  await ctx.adminPool.query('delete from diagnosis_leads');
});

const oldLead = () =>
  ctx.adminPool.query("insert into diagnosis_leads (name, contact, consent_contact, created_at) values ('x','y',true, now() - interval '2 years')");
const leadCount = async () => Number((await ctx.adminPool.query('select count(*) c from diagnosis_leads')).rows[0].c);
// KST = UTC+9, so 03:00 KST is 18:00 UTC of the previous day
const kst = (date: string, hhmm: string) => new Date(new Date(`${date}T${hhmm}:00Z`).getTime() - 9 * 3600_000);

test('runJob 결과 건수 반환', async () => {
  await oldLead();
  await oldLead();
  expect(await runJob(ctx.pool, 'purge_old_diagnosis_leads')).toBe(2);
  expect(await runJob(ctx.pool, 'purge_old_diagnosis_leads')).toBe(0);
});

test('다른 연결이 advisory lock을 잡고 있으면 건너뜀', async () => {
  await oldLead();
  const holder = await ctx.adminPool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query("select pg_advisory_xact_lock(hashtext('bara_edu.jobs.purge_old_diagnosis_leads'))");
    expect(await runJob(ctx.pool, 'purge_old_diagnosis_leads')).toBeNull();
    expect(await leadCount()).toBe(1);
    await holder.query('COMMIT');
  } finally {
    holder.release();
  }
  expect(await runJob(ctx.pool, 'purge_old_diagnosis_leads')).toBe(1);
});

test('03:00 KST가 된 확인 주기에 purge_unverified_signups 1회만 실행', async () => {
  await oldLead();
  let now = kst('2026-11-25', '02:59');
  const s = startScheduler(ctx.pool, { now: () => now, log });
  try {
    await s.tick();
    expect(logs).toEqual([]);

    now = kst('2026-11-25', '03:00');
    await s.tick();
    const ran = () => logs.filter((l) => l.level === 'info').map((l) => (l.obj as any).job);
    expect(ran()).toEqual(['purge_unverified_signups']);
    expect(logs[0].obj).toMatchObject({ job: 'purge_unverified_signups', count: 0 });

    await s.tick();
    expect(ran()).toEqual(['purge_unverified_signups']);

    now = kst('2026-11-25', '03:35');
    await s.tick();
    expect(ran()).toEqual(['purge_unverified_signups', 'purge_old_admin_access_logs', 'purge_unclaimed_diagnosis_pii', 'purge_old_diagnosis_leads']);
    expect(await leadCount()).toBe(0);

    now = kst('2026-11-26', '03:00');
    await s.tick();
    expect(ran().length).toBe(5);
  } finally {
    s.stop();
  }
});

test('작업 실패는 로그만 남기고 같은 날 다음 주기에 재시도', async () => {
  const broken = { connect: async () => { throw Object.assign(new Error('secret row value'), { code: '57P01' }); } } as never;
  const now = kst('2026-11-25', '03:35');
  const s = startScheduler(broken, { now: () => now, log });
  try {
    await s.tick();
    await s.tick();
    const errs = logs.filter((l) => l.level === 'error');
    expect(errs.length).toBe(8);
    expect(JSON.stringify(errs)).not.toContain('secret row value');
    expect(errs[0].obj).toMatchObject({ job: 'purge_unverified_signups', code: '57P01' });
  } finally {
    s.stop();
  }
});

// ---- 탈퇴 회원 사진 정리 (처리방침 제3조: 5일 내 파기) — 커밋 뒤 삭제가 실패했을 때를 위한 매일 재시도
import { MemoryStorage } from '../src/storage/storage.js';
import { purgeWithdrawnPhotos } from '../src/jobs/scheduler.js';

async function member(status: 'active' | 'withdrawn', withdrawnAgo?: string) {
  const id = (await ctx.adminPool.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [`ph${Math.random().toString(36).slice(2)}@example.com`])).rows[0].id as string;
  if (status === 'withdrawn') {
    await ctx.adminPool.query(`update profiles set status = 'withdrawn', withdrawn_at = now() - interval '${withdrawnAgo ?? '1 day'}' where id = $1`, [id]);
  }
  return id;
}
const put = (s: MemoryStorage, id: string) => s.put(`${id}/photo`, Buffer.from('x'), 'image/jpeg');

test('purgeWithdrawnPhotos: 최근 7일 안에 탈퇴한 회원의 사진만 지운다 (활동 회원·오래전 탈퇴는 그대로)', async () => {
  const s = new MemoryStorage();
  const gone = await member('withdrawn', '1 day');
  const older = await member('withdrawn', '30 days');
  const active = await member('active');
  for (const id of [gone, older, active]) await put(s, id);
  expect(await purgeWithdrawnPhotos(ctx.pool, s, log)).toBe(1);
  expect(s.objects.has(`${gone}/photo`)).toBe(false);
  expect(s.objects.has(`${older}/photo`)).toBe(true);
  expect(s.objects.has(`${active}/photo`)).toBe(true);
});

test('purgeWithdrawnPhotos: 한 명의 삭제 실패가 나머지를 막지 않고, 로그에는 userId만 남는다 (이메일·객체 내용 없음)', async () => {
  const s = new MemoryStorage();
  const bad = await member('withdrawn');
  const good = await member('withdrawn');
  await put(s, bad);
  await put(s, good);
  const realRemove = s.remove.bind(s);
  s.remove = async (key: string) => {
    if (key.startsWith(bad)) throw Object.assign(new Error('secret@leak.example'), { name: 'S3Down' });
    return realRemove(key);
  };
  logs.length = 0;
  await purgeWithdrawnPhotos(ctx.pool, s, log);
  expect(s.objects.has(`${good}/photo`)).toBe(false);
  expect(s.objects.has(`${bad}/photo`)).toBe(true);
  const errs = logs.filter((l) => l.level === 'error');
  expect(errs).toHaveLength(1);
  expect(errs[0].obj).toMatchObject({ job: 'purge_withdrawn_photos', userId: bad, errName: 'S3Down' });
  expect(JSON.stringify(errs)).not.toContain('leak.example');
  expect(JSON.stringify(errs)).not.toContain('@example.com');
});

test('다른 연결이 advisory lock을 잡고 있으면 사진 정리는 건너뛴다(null)', async () => {
  const s = new MemoryStorage();
  const id = await member('withdrawn');
  await put(s, id);
  const holder = await ctx.adminPool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query("select pg_advisory_xact_lock(hashtext('bara_edu.jobs.purge_withdrawn_photos'))");
    expect(await purgeWithdrawnPhotos(ctx.pool, s, log)).toBeNull();
    expect(s.objects.has(`${id}/photo`)).toBe(true);
    await holder.query('COMMIT');
  } finally {
    holder.release();
  }
});

test('스케줄러: storage를 주면 03:40 KST에 하루 1번 사진 정리를 실행, 주지 않으면 실행하지 않는다', async () => {
  const s = new MemoryStorage();
  const id = await member('withdrawn');
  await put(s, id);
  logs.length = 0;
  const now = kst('2026-12-01', '03:40');
  const withStorage = startScheduler(ctx.pool, { now: () => now, log, storage: s });
  try {
    await withStorage.tick();
    expect(logs.filter((l) => (l.obj as any).job === 'purge_withdrawn_photos')).toHaveLength(1);
    expect(s.objects.has(`${id}/photo`)).toBe(false);
    await withStorage.tick();
    expect(logs.filter((l) => (l.obj as any).job === 'purge_withdrawn_photos')).toHaveLength(1);
  } finally {
    withStorage.stop();
  }
  logs.length = 0;
  const without = startScheduler(ctx.pool, { now: () => now, log });
  try {
    await without.tick();
    expect(logs.filter((l) => (l.obj as any).job === 'purge_withdrawn_photos')).toHaveLength(0);
  } finally {
    without.stop();
  }
});
