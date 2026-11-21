import type pg from 'pg';
import { withService } from '../db/context.js';

export const JOBS = [
  { name: 'purge_unverified_signups', minuteOfDay: 3 * 60 },
  { name: 'purge_old_admin_access_logs', minuteOfDay: 3 * 60 + 10 },
  { name: 'purge_unclaimed_diagnosis_pii', minuteOfDay: 3 * 60 + 20 },
  { name: 'purge_old_diagnosis_leads', minuteOfDay: 3 * 60 + 30 },
] as const;

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

export function startScheduler(
  pool: pg.Pool,
  opts: { now?: () => Date; log: JobLog; intervalMs?: number },
): { stop(): void; tick(): Promise<void> } {
  const now = opts.now ?? (() => new Date());
  const { log } = opts;
  const doneOn = new Map<JobName, string>();
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const kst = new Date(now().getTime() + KST_OFFSET_MS);
      const date = kst.toISOString().slice(0, 10);
      const minuteOfDay = kst.getUTCHours() * 60 + kst.getUTCMinutes();
      for (const { name, minuteOfDay: slot } of JOBS) {
        if (minuteOfDay < slot || doneOn.get(name) === date) continue;
        try {
          const count = await runJob(pool, name);
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
