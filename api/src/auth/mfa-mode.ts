import type pg from 'pg';
import { withService } from '../db/context.js';
import type { MfaConfig, MfaMode } from '../config.js';
import { verifyKeyCheckIn } from './mfa-crypto.js';

export type StartupLog = { info(obj: object, msg?: string): void; warn(obj: object, msg?: string): void };

// 모드 전환 감지(기획서 2.14, 보안 점검 I-2): 마지막으로 시작한 모드(auth.mfa_runtime)와 다르면(행이 없어도) 한 트랜잭션에서
// role='admin' 사용자의 mfa_at 없는(비밀번호만의) 세션을 모두 지우고 모드를 기록한다. 여러 프로세스가 함께 떠도 한 번만 하도록 advisory lock.
export async function applyModeTransition(pool: pg.Pool, mode: MfaMode): Promise<{ changed: boolean; deletedSessions: number; previous: MfaMode | null }> {
  return withService(pool, async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', ['bara_edu.mfa_runtime']);
    const r = await tx.query<{ mode: MfaMode }>('select mode from auth.mfa_runtime where id = 1 for update');
    const previous = r.rows[0]?.mode ?? null;
    if (previous === mode) return { changed: false, deletedSessions: 0, previous };
    const d = await tx.query(
      `delete from auth.sessions s where s.mfa_at is null
          and exists (select 1 from public.profiles p where p.id = s.user_id and p.role = 'admin')`,
    );
    await tx.query(
      `insert into auth.mfa_runtime (id, mode, changed_at) values (1, $1, now())
       on conflict (id) do update set mode = excluded.mode, changed_at = excluded.changed_at`,
      [mode],
    );
    return { changed: true, deletedSessions: d.rowCount, previous };
  });
}

// API 시작 때 한 번(server.ts). 키 검증(auth.mfa_key_check) 실패는 시작 거절. 로그에는 모드와 키 버전 목록만(값 없음).
export async function initMfa(pool: pg.Pool, mfa: MfaConfig, log: StartupLog): Promise<void> {
  if (mfa.keyring) await withService(pool, (tx) => verifyKeyCheckIn(tx, mfa.keyring!));
  const t = await applyModeTransition(pool, mfa.mode);
  log.info({ event: 'mfa_mode', mode: mfa.mode, keyVersions: mfa.keyring ? [...mfa.keyring.versions] : [], currentKeyVersion: mfa.keyring?.current ?? null }, 'admin mfa mode');
  if (t.changed) log.info({ event: 'mfa_mode_changed', previous: t.previous, mode: mfa.mode, deletedAdminSessions: t.deletedSessions }, 'admin mfa mode changed: password-only admin sessions removed');
  if (mfa.mode !== 'enforce') log.warn({ event: 'mfa_mode_weak', mode: mfa.mode }, 'admin two-step verification is not enforced');
  if (!mfa.keyring) log.warn({ event: 'mfa_keys_missing' }, 'admin mfa keys are not configured; mfa endpoints answer 503');
}
