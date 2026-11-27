// 관리자 2단계 인증 운영 명령(기획서 2.7.3). 서버에서 개발 담당만 실행한다(SSM Session Manager 접속, 보안 점검 M-5).
// 실행: node dist/scripts/admin-mfa.js <명령> [--email <대상>] --operator "<작업자 이름>" [--reason <사유키>]
//   mfa-reset  --email --operator --reason   등록·복구 코드·세션·대기표 삭제 + 등록 코드 발급(터미널에 한 번만 출력)
//   mfa-ticket --email --operator            등록 코드만 발급(첫 관리자·승격). 이미 등록된 계정은 거절(mfa-reset을 쓴다)
//   mfa-clear  --email --operator            강등 뒤 정리(대상이 아직 admin이면 거절)
//   mfa-unlock --email --operator --reason   mfa-fail 잠김 해제(등록 정보는 그대로)
//   mfa-report --operator                    강제 전 점검표(비밀 값 없음, 보안 점검 I-8)
//   mfa-rekey  --operator                    키 교체 3단계: 등록을 현재 키로 다시 암호화, 등록 대기 삭제, 옛 버전 행 수 출력
//   admin-sessions-revoke --operator         관리자 세션 전부 삭제(수동 비상용)
// 설정은 API와 같은 환경 변수를 읽는다(DATABASE_URL, BARA_MFA_KEY_PARAMS/BARA_MFA_KEY_CURRENT, ADMIN_SECURITY_ALERT_TO, MAIL_FROM 등).
// 모든 변경 명령은 접속 기록을 같은 트랜잭션에 남기고, 기록이 실패하면 롤백한다. 비밀 값은 출력하지 않는다(예외: 등록 코드 1회).
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type pg from 'pg';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { withService, type Tx } from '../src/db/context.js';
import { decryptSecret, encryptSecret, MfaKeyError, verifyKeyCheckIn, type MfaKeyring } from '../src/auth/mfa-crypto.js';
import { planAlertsIn, selfOnlySuffix } from '../src/auth/mfa-alerts.js';
import {
  clearUserMfaIn,
  FAIL_BUCKET,
  FAIL_RELEASED_BUCKET,
  issueEnrollTicketIn,
  lockUserMfaIn,
  logIn,
  LogFailed,
  MFA_ACTIONS,
  resetTargetIn,
  touchStateIn,
} from '../src/auth/mfa.js';
import { kstStamp } from '../src/mail/kst.js';
import type { Mailer, MailMessage } from '../src/mail/mailer.js';
import { SesMailer } from '../src/mail/ses.js';
import { resolveMfaKeyring, resolveServiceKey } from '../src/secrets.js';

export const RESET_REASONS = ['lost_phone', 'new_phone', 'app_deleted', 'sole_admin_locked', 'key_lost', 'incident'] as const;
export const UNLOCK_REASONS = ['owner_locked', 'attack_suspected'] as const;
export const COMMANDS = ['mfa-reset', 'mfa-ticket', 'mfa-clear', 'mfa-unlock', 'mfa-report', 'mfa-rekey', 'admin-sessions-revoke'] as const;
export const TICKET_WARNING = '경고: 다음 줄에 등록 코드가 한 번만 나옵니다. 세션 기록이 꺼져 있는지 확인하고, 전화·대면으로만 전달한 뒤 화면을 지우세요.';

export type CliDeps = {
  pool: pg.Pool;
  keyring: MfaKeyring | null;
  mode: string;
  alertTo: readonly string[];
  mailer: Mailer | null;
  out(line: string): void;
  err(line: string): void;
};

export class CliError extends Error {}

// 작업자 이름은 접속 기록 detail(키=값;…)에 들어가므로 구분자·제어 문자를 받지 않는다
const OPERATOR_RE = /^[^;=\p{Cc}]{1,50}$/u;
// admin-sessions-revoke 접속 기록 action(개인정보 점검 권고 3, 2026-11-27). 보안 사건 목록(대시보드)에는 넣지 않는다.
const ADMIN_SESSIONS_REVOKED = '관리자세션일괄종료';

type Target = { id: string; email: string; role: string | null; status: string | null; enrolled: boolean };

async function findTarget(tx: Tx, email: string): Promise<Target> {
  const r = await tx.query<Target>(
    `select u.id, u.email, p.role::text as role, p.status::text as status,
            exists (select 1 from auth.mfa_factors f where f.user_id = u.id) as enrolled
       from auth.users u left join public.profiles p on p.id = u.id where lower(u.email) = lower($1)`,
    [email.trim()],
  );
  if (r.rowCount === 0) throw new CliError('대상 계정을 찾을 수 없습니다');
  return r.rows[0];
}

const requireRing = (deps: CliDeps) => {
  if (!deps.keyring) throw new CliError('2단계 인증 키가 설정되지 않았습니다(BARA_MFA_KEY_PARAMS 또는 로컬 BARA_MFA_KEYS)');
  return deps.keyring;
};

// 암호문·HMAC을 읽거나 쓰는 명령은 쓰기 전에 같은 트랜잭션에서 키 검증(auth.mfa_key_check)을 먼저 한다.
// 셸의 키가 API와 다르면(다른 BARA_MFA_KEY_PARAMS) 아무것도 쓰지 않고 멈춘다. 검증 행은 만들지 않는다(API 시작만 만든다).
async function checkRingIn(tx: Tx, ring: MfaKeyring): Promise<void> {
  await verifyKeyCheckIn(tx, ring, { create: false });
}
export const KEY_MISMATCH_MESSAGE = '2단계 인증 키가 API의 키와 다릅니다(auth.mfa_key_check 불일치). 아무것도 바꾸지 않았습니다. BARA_MFA_KEY_PARAMS·BARA_MFA_KEY_CURRENT가 API 서버와 같은지 확인하세요';

async function send(deps: CliDeps, mails: MailMessage[]): Promise<void> {
  if (!deps.mailer) {
    if (mails.length) deps.err(`메일 ${mails.length}통을 보내지 못했습니다(MAIL_FROM 없음). 대상·다른 관리자에게 직접 알려 주세요.`);
    return;
  }
  for (const m of mails) {
    try {
      await deps.mailer.send(m);
    } catch (e) {
      deps.err(`메일 발송 실패(${m.template}, ${e instanceof Error ? e.name : 'unknown'})`);
    }
  }
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  let command: string;
  let values: { email?: string; operator?: string; reason?: string };
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { email: { type: 'string' }, operator: { type: 'string' }, reason: { type: 'string' } },
      strict: true,
    });
    command = parsed.positionals[0] ?? '';
    values = parsed.values;
    if (parsed.positionals.length !== 1 || !(COMMANDS as readonly string[]).includes(command)) throw new CliError(`usage: admin-mfa <${COMMANDS.join('|')}> [--email <대상>] --operator "<작업자>" [--reason <키>]`);
  } catch (err) {
    deps.err(err instanceof CliError ? err.message : `usage: admin-mfa <${COMMANDS.join('|')}> [--email <대상>] --operator "<작업자>" [--reason <키>]`);
    return 2;
  }
  try {
    const operator = (values.operator ?? '').trim();
    if (!OPERATOR_RE.test(operator)) throw new CliError('--operator(작업자 이름, 1~50자, ; = 제외)가 필요합니다');
    const needEmail = ['mfa-reset', 'mfa-ticket', 'mfa-clear', 'mfa-unlock'].includes(command);
    if (needEmail && !values.email) throw new CliError('--email이 필요합니다');
    switch (command) {
      case 'mfa-reset':
        return await mfaReset(deps, values.email!, operator, values.reason);
      case 'mfa-ticket':
        return await mfaTicket(deps, values.email!, operator);
      case 'mfa-clear':
        return await mfaClear(deps, values.email!, operator);
      case 'mfa-unlock':
        return await mfaUnlock(deps, values.email!, operator, values.reason);
      case 'mfa-report':
        return await mfaReport(deps);
      case 'mfa-rekey':
        return await mfaRekey(deps);
      default:
        return await revokeAdminSessions(deps, operator);
    }
  } catch (err) {
    if (err instanceof CliError) deps.err(err.message);
    else if (err instanceof MfaKeyError) deps.err(`${KEY_MISMATCH_MESSAGE} (${err.message})`);
    else if (err instanceof LogFailed) deps.err('접속 기록을 남기지 못해 아무것도 바꾸지 않았습니다');
    else deps.err(`실패(${(err as { code?: string; name?: string })?.code ?? (err as Error)?.name ?? 'error'})`);
    return 1;
  }
}

async function mfaReset(deps: CliDeps, email: string, operator: string, reason: string | undefined): Promise<number> {
  if (!reason || !(RESET_REASONS as readonly string[]).includes(reason)) throw new CliError(`--reason은 ${RESET_REASONS.join(', ')} 중 하나여야 합니다`);
  const ring = requireRing(deps);
  const r = await withService(deps.pool, async (tx) => {
    await checkRingIn(tx, ring);
    const t = await findTarget(tx, email);
    if (t.role !== 'admin' || t.status !== 'active') throw new CliError('대상이 활성 관리자가 아닙니다');
    const ticket = await resetTargetIn(tx, ring, t.id, null);
    const at = kstStamp(new Date());
    const plan = await planAlertsIn(tx, t.id, deps.alertTo, { own: { template: 'mfa_reset', at, by: 'db' }, alert: 'reset', at });
    // 관리자 행이 하나뿐일 수 있으므로 기록 주체는 대상 자신(기존 비밀번호재설정 기록과 같은 방식, 2.7.3 5)
    await logIn(tx, t.id, t.id, MFA_ACTIONS.reset, `by=db;operator=${operator};reason=${reason}${selfOnlySuffix(plan)}`, null);
    return { ticket, mails: plan.messages, selfOnly: plan.selfOnly };
  });
  deps.out('초기화했습니다. 대상의 모든 세션·등록·복구 코드를 지웠습니다.');
  if (r.selfOnly) deps.out('알림: 다른 관리자·운영 주소가 없어 본인 메일만 보냅니다(접속 기록 alert=self_only).');
  deps.out(TICKET_WARNING);
  deps.out(`등록 코드: ${r.ticket.code.slice(0, 4)} ${r.ticket.code.slice(4)} (유효: ${kstStamp(r.ticket.expiresAt)}까지)`);
  await send(deps, r.mails);
  return 0;
}

async function mfaTicket(deps: CliDeps, email: string, operator: string): Promise<number> {
  const ring = requireRing(deps);
  const ticket = await withService(deps.pool, async (tx) => {
    await checkRingIn(tx, ring);
    const t = await findTarget(tx, email);
    if (t.role !== 'admin' || t.status !== 'active') throw new CliError('대상이 활성 관리자가 아닙니다');
    await lockUserMfaIn(tx, t.id);
    const enrolled = await tx.query('select 1 from auth.mfa_factors where user_id = $1', [t.id]);
    if (enrolled.rowCount !== 0) throw new CliError('이미 등록된 계정입니다. 초기화가 필요하면 mfa-reset을 쓰세요');
    const out = await issueEnrollTicketIn(tx, ring, t.id, null);
    await touchStateIn(tx, t.id, 'ticket_required_at = coalesce(ticket_required_at, now())');
    // 다른 관리자·운영 주소에 알린다(보안 점검 m-3). 본인 메일은 보내지 않는다(등록 코드는 전화로 전달, 메일에 비밀 값 없음).
    const plan = await planAlertsIn(tx, t.id, deps.alertTo, { own: null, alert: 'ticket_issued', at: kstStamp(new Date()) });
    await logIn(tx, t.id, t.id, MFA_ACTIONS.ticketIssued, `by=db;operator=${operator}${selfOnlySuffix(plan)}`, null);
    return { ...out, mails: plan.messages, selfOnly: plan.selfOnly };
  });
  if (ticket.selfOnly) deps.out('알림: 다른 관리자·운영 주소가 없어 알림 메일을 보내지 않았습니다(접속 기록 alert=self_only).');
  deps.out(TICKET_WARNING);
  deps.out(`등록 코드: ${ticket.code.slice(0, 4)} ${ticket.code.slice(4)} (유효: ${kstStamp(ticket.expiresAt)}까지)`);
  await send(deps, ticket.mails);
  return 0;
}

async function mfaClear(deps: CliDeps, email: string, operator: string): Promise<number> {
  await withService(deps.pool, async (tx) => {
    const t = await findTarget(tx, email);
    if (t.role === 'admin') throw new CliError('대상이 아직 관리자입니다. 먼저 강등한 뒤 실행하세요');
    if (t.role === null) throw new CliError('대상의 프로필이 없습니다');
    await lockUserMfaIn(tx, t.id);
    await clearUserMfaIn(tx, t.id);
    // 이력은 남겨 다시 승격되면 등록 코드를 요구한다(2.7.4)
    await touchStateIn(tx, t.id, 'ticket_required_at = coalesce(ticket_required_at, now())');
    await logIn(tx, t.id, t.id, MFA_ACTIONS.reset, `by=db;operator=${operator};reason=demoted`, null);
  });
  deps.out('정리했습니다. 2단계 인증 등록·복구 코드·대기표·등록 코드를 지웠습니다(이력 표시는 남김).');
  return 0;
}

async function mfaUnlock(deps: CliDeps, email: string, operator: string, reason: string | undefined): Promise<number> {
  if (!reason || !(UNLOCK_REASONS as readonly string[]).includes(reason)) throw new CliError(`--reason은 ${UNLOCK_REASONS.join(', ')} 중 하나여야 합니다`);
  const n = await withService(deps.pool, async (tx) => {
    const t = await findTarget(tx, email);
    // 탈퇴한 관리자 계정은 풀지 않는다(보안 점검 N-5). mfa-reset·mfa-ticket과 같은 검사.
    if (t.role !== 'admin' || t.status !== 'active') throw new CliError('대상이 활성 관리자가 아닙니다');
    const d = await tx.query('delete from auth.rate_events where key = $1 and bucket = any($2)', [t.id, [FAIL_BUCKET, FAIL_RELEASED_BUCKET]]);
    // 다른 관리자·운영 주소에 알린다(보안 점검 m-3). 본인 메일은 보내지 않는다(잠금을 부른 사람이 메일함을 가진 공격자일 수 있다).
    const plan = await planAlertsIn(tx, t.id, deps.alertTo, { own: null, alert: 'unlocked', at: kstStamp(new Date()) });
    await logIn(tx, t.id, t.id, MFA_ACTIONS.unlocked, `by=db;operator=${operator};reason=${reason}${selfOnlySuffix(plan)}`, null);
    return { n: d.rowCount, mails: plan.messages, selfOnly: plan.selfOnly };
  });
  deps.out(`잠금을 풀었습니다(실패 기록 ${n.n}건 삭제). 비밀번호가 샜을 수 있으면 먼저 비밀번호 재설정을 권합니다.`);
  if (n.selfOnly) deps.out('알림: 다른 관리자·운영 주소가 없어 알림 메일을 보내지 않았습니다(접속 기록 alert=self_only).');
  await send(deps, n.mails);
  return 0;
}

async function mfaReport(deps: CliDeps): Promise<number> {
  const rows = await withService(deps.pool, async (tx) =>
    (
      await tx.query<{
        name: string;
        email: string;
        confirmed_at: Date | null;
        enrolled_via: string | null;
        enrolled_ip: string | null;
        left: number;
        issued: Date | null;
        acked: Date | null;
        ticket_required_at: Date | null;
        totp_logins: number;
        recent: Array<{ at: string; ip: string | null; detail: string }> | null;
      }>(
        `select p.name, u.email, f.confirmed_at, f.enrolled_via, host(f.enrolled_ip) as enrolled_ip,
                (select count(*)::int from auth.mfa_recovery_codes rc where rc.user_id = u.id and rc.used_at is null) as left,
                st.recovery_codes_issued_at as issued, st.recovery_codes_acked_at as acked, st.ticket_required_at,
                (select count(*)::int from admin_access_logs l where l.target_user_id = u.id and l.action = '로그인' and l.detail = 'mfa=totp') as totp_logins,
                (select json_agg(x order by x.at desc) from (
                   select l.created_at as at, l.ip_address as ip, l.detail from admin_access_logs l
                    where l.target_user_id = u.id and l.action = '로그인' order by l.created_at desc limit 3) x) as recent
           from public.profiles p join auth.users u on u.id = p.id
           left join auth.mfa_factors f on f.user_id = u.id
           left join auth.mfa_account_state st on st.user_id = u.id
          where p.role = 'admin' and p.status = 'active'
          order by u.email`,
      )
    ).rows,
  );
  deps.out(`현재 모드: ${deps.mode}  활성 관리자: ${rows.length}명`);
  for (const r of rows) {
    const acked = r.issued === null ? '-' : r.acked !== null && r.acked >= r.issued ? '예' : '아니오';
    deps.out(
      [
        `- ${r.name} <${r.email}>`,
        `등록: ${r.confirmed_at ? `예(${kstStamp(r.confirmed_at)}, 경로 ${r.enrolled_via}, IP ${r.enrolled_ip ?? '-'})` : '아니오'}`,
        `복구 코드 남음: ${r.left}개(보관 확인: ${acked})`,
        `6자리 로그인: ${r.totp_logins}회`,
        `등록 코드 필요 표시: ${r.ticket_required_at ? kstStamp(r.ticket_required_at) : '-'}`,
      ].join(' | '),
    );
    for (const l of r.recent ?? []) deps.out(`    최근 로그인 ${kstStamp(new Date(l.at))} IP ${l.ip ?? '-'} (${l.detail})`);
  }
  deps.out('각 행의 등록 일시·IP·경로·최근 로그인 IP가 본인 것인지 대표가 확인한 뒤 강제(enforce)합니다(기획서 7.1 단계 2).');
  return 0;
}

async function mfaRekey(deps: CliDeps): Promise<number> {
  const ring = requireRing(deps);
  if (ring.versions.length < 2) throw new CliError('키 버전이 하나뿐입니다. 새 키를 BARA_MFA_KEY_PARAMS에 더하고 BARA_MFA_KEY_CURRENT를 바꾼 뒤 실행하세요');
  const r = await withService(deps.pool, async (tx) => {
    await checkRingIn(tx, ring);
    const fs = await tx.query<{ user_id: string; secret_ciphertext: Buffer; secret_iv: Buffer; key_version: number }>(
      'select user_id, secret_ciphertext, secret_iv, key_version from auth.mfa_factors where key_version <> $1 order by user_id for update',
      [ring.current],
    );
    for (const f of fs.rows) {
      const secret = decryptSecret(ring, f.user_id, 'factor', { ciphertext: f.secret_ciphertext, iv: f.secret_iv, keyVersion: f.key_version });
      const s = encryptSecret(ring, f.user_id, 'factor', secret); // 새 IV
      secret.fill(0);
      await tx.query('update auth.mfa_factors set secret_ciphertext = $2, secret_iv = $3, key_version = $4 where user_id = $1', [f.user_id, s.ciphertext, s.iv, s.keyVersion]);
    }
    const e = await tx.query('delete from auth.mfa_enrollments');
    const rc = await tx.query<{ v: number; n: number }>('select key_version as v, count(*)::int as n from auth.mfa_recovery_codes where key_version <> $1 and used_at is null group by 1 order by 1', [ring.current]);
    const tk = await tx.query<{ v: number; n: number }>('select key_version as v, count(*)::int as n from auth.mfa_enroll_tickets where key_version <> $1 and used_at is null group by 1 order by 1', [ring.current]);
    return { factors: fs.rowCount, enrollments: e.rowCount, rc: rc.rows, tk: tk.rows };
  });
  deps.out(`다시 암호화한 등록: ${r.factors}건(현재 버전 v${ring.current}), 지운 등록 대기: ${r.enrollments}건`);
  const fmt = (rows: Array<{ v: number; n: number }>) => (rows.length ? rows.map((x) => `v${x.v}=${x.n}`).join(', ') : '0');
  deps.out(`옛 버전 복구 코드(미사용): ${fmt(r.rc)}`);
  deps.out(`옛 버전 등록 코드(미사용): ${fmt(r.tk)}`);
  deps.out('옛 버전 행 수가 모두 0이 되면 옛 키를 설정에서 빼고 SSM 파라미터와 auth.mfa_key_check 행을 지웁니다(기획서 2.6).');
  return 0;
}

async function revokeAdminSessions(deps: CliDeps, operator: string): Promise<number> {
  const n = await withService(deps.pool, async (tx) => {
    const d = await tx.query<{ user_id: string; n: number }>(
      `with d as (delete from auth.sessions s where exists (select 1 from public.profiles p where p.id = s.user_id and p.role = 'admin') returning s.user_id)
       select user_id, count(*)::int as n from d group by user_id`,
    );
    // 세션이 지워진 관리자마다 기록 1건(개인정보 점검 권고 3). 지운 세션이 없으면 바뀐 것이 없으므로 기록하지 않는다.
    for (const r of d.rows) await logIn(tx, r.user_id, r.user_id, ADMIN_SESSIONS_REVOKED, `by=db;operator=${operator};sessions=${r.n}`, null);
    return d.rows.reduce((sum, r) => sum + r.n, 0);
  });
  deps.out(`관리자 세션 ${n}개를 지웠습니다.`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  let pool: pg.Pool | null = null;
  try {
    const env = process.env;
    const config = loadConfig(env, { serviceKey: await resolveServiceKey(env), mfaKeyring: await resolveMfaKeyring(env) });
    pool = createPool(config.databaseUrl);
    const mailer = env.MAIL_FROM ? new SesMailer(new SESv2Client({ region: config.awsRegion }), env.MAIL_FROM, undefined, config.adminContactPhone) : null;
    return await runCli(argv, {
      pool,
      keyring: config.mfa.keyring,
      mode: config.mfa.mode,
      alertTo: config.mfa.alertTo,
      mailer,
      out: (l) => console.log(l),
      err: (l) => console.error(l),
    });
  } catch (err) {
    // 설정 오류는 고정 문구(값 없음)
    console.error(`admin-mfa failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    return 1;
  } finally {
    await pool?.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
