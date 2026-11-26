import type pg from 'pg';
import { withService } from '../db/context.js';
import type { Storage } from '../storage/storage.js';

export const JOBS = [
  { name: 'purge_unverified_signups', minuteOfDay: 3 * 60 },
  { name: 'purge_old_admin_access_logs', minuteOfDay: 3 * 60 + 10 },
  { name: 'purge_unclaimed_diagnosis_pii', minuteOfDay: 3 * 60 + 20 },
  { name: 'purge_old_diagnosis_leads', minuteOfDay: 3 * 60 + 30 },
  // 관리자 2단계 인증의 만료된 대기표·등록 대기·등록 코드(기획서 2.11)
  { name: 'purge_expired_mfa_rows', minuteOfDay: 3 * 60 + 50 },
] as const;

// S3 객체를 지우는 작업(storage가 있을 때만 실행). SQL 함수가 아니라서 JOBS와 따로 둔다.
export const PHOTO_JOB = { name: 'purge_withdrawn_photos', minuteOfDay: 3 * 60 + 40 } as const;
// 탈퇴 직후 커밋 뒤 삭제가 실패했을 때를 위한 재시도 창. 처리방침 제3조: 5일 안에 파기 -> 매일 7일치를 다시 지운다.
const PHOTO_RETRY_DAYS = 7;

export type JobName = (typeof JOBS)[number]['name'];
export type JobLog = { info(obj: object, msg?: string): void; error(obj: object, msg?: string): void };

const KST_OFFSET_MS = 9 * 3600_000;

// returns null when another process holds the lock; the xact lock lives on the same connection as the work
export async function runJob(pool: pg.Pool, name: JobName): Promise<number | null> {
  if (!JOBS.some((j) => j.name === name)) throw new Error(`unknown job: ${name}`);
  return withService(pool, async (tx) => {
    const lock = await tx.query<{ ok: boolean }>('select pg_try_advisory_xact_lock(hashtext($1)) as ok', [`bara_edu.jobs.${name}`]);
    if (!lock.rows[0].ok) return null;
    const r = await tx.query<{ n: number }>(`select public.${name}() as n`);
    return Number(r.rows[0].n);
  });
}

// 최근 탈퇴한 회원의 사진(<uid>/photo)을 다시 지운다. S3 삭제는 없는 객체에도 성공하므로 매일 같은 대상을 지워도 안전하다.
// 한 명이 실패해도 나머지는 계속하고, 실패 로그에는 userId(가명 식별자)와 오류 이름만 남긴다.
export async function purgeWithdrawnPhotos(pool: pg.Pool, storage: Storage, log: JobLog): Promise<number | null> {
  return withService(pool, async (tx) => {
    const lock = await tx.query<{ ok: boolean }>('select pg_try_advisory_xact_lock(hashtext($1)) as ok', [`bara_edu.jobs.${PHOTO_JOB.name}`]);
    if (!lock.rows[0].ok) return null;
    const r = await tx.query<{ id: string }>(
      "select id from profiles where status = 'withdrawn' and withdrawn_at > now() - make_interval(days => $1::int) order by id",
      [PHOTO_RETRY_DAYS],
    );
    let removed = 0;
    for (const { id } of r.rows) {
      try {
        await storage.remove(`${id}/photo`);
        removed += 1;
      } catch (err) {
        log.error({ job: PHOTO_JOB.name, userId: id, errName: String((err as { name?: unknown })?.name ?? 'Error') }, 'withdrawn photo removal failed');
      }
    }
    return removed;
  });
}

export function startScheduler(
  pool: pg.Pool,
  opts: { now?: () => Date; log: JobLog; intervalMs?: number; storage?: Storage },
): { stop(): void; tick(): Promise<void> } {
  const now = opts.now ?? (() => new Date());
  const { log } = opts;
  const doneOn = new Map<string, string>();
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const kst = new Date(now().getTime() + KST_OFFSET_MS);
      const date = kst.toISOString().slice(0, 10);
      const minuteOfDay = kst.getUTCHours() * 60 + kst.getUTCMinutes();
      const jobs: ReadonlyArray<{ name: JobName | typeof PHOTO_JOB.name; minuteOfDay: number }> = opts.storage ? [...JOBS, PHOTO_JOB] : JOBS;
      for (const { name, minuteOfDay: slot } of jobs) {
        if (minuteOfDay < slot || doneOn.get(name) === date) continue;
        try {
          const count = name === PHOTO_JOB.name ? await purgeWithdrawnPhotos(pool, opts.storage!, log) : await runJob(pool, name);
          doneOn.set(name, date);
          if (count === null) log.info({ job: name, skipped: true }, 'job skipped: lock held elsewhere');
          else log.info({ job: name, count }, 'job done');
        } catch (err) {
          const e = err as { name?: unknown; code?: unknown };
          log.error({ job: name, errName: String(e?.name ?? 'Error'), code: e?.code }, 'job failed');
        }
      }
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), opts.intervalMs ?? 60_000);
  timer.unref();
  return { stop: () => clearInterval(timer), tick };
}
