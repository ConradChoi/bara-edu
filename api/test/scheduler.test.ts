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
