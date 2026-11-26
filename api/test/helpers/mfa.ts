import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../../src/app.js';
import { loadConfig, type MfaMode } from '../../src/config.js';
import { MemoryMailer, type MailMessage } from '../../src/mail/mailer.js';
import { MemoryStorage } from '../../src/storage/storage.js';
import { encryptSecret, makeKeyring, type MfaKeyring } from '../../src/auth/mfa-crypto.js';
import { base32Decode, hotp, stepAt } from '../../src/auth/totp.js';
import { createSession, type MfaMethod } from '../../src/auth/sessions.js';

// 관리자 2단계 인증 테스트 공용 도구. 키는 테스트 전용 고정값이다.
export const KEY = 'k'.repeat(32);
export const MASTER_V1 = Buffer.alloc(32, 1).toString('base64');
export const MASTER_V2 = Buffer.alloc(32, 2).toString('base64');
export const RING_V1 = makeKeyring(new Map([[1, Buffer.from(MASTER_V1, 'base64')]]), 1);
export const PASSWORD = 'password1';
const HASH = bcrypt.hashSync(PASSWORD, 4);

export type Ctx = { pool: pg.Pool; adminPool: pg.Pool };

export class Mails extends MemoryMailer {}

export function mfaApp(
  ctx: Ctx,
  opts: { mode?: MfaMode; keys?: string; current?: string; alertTo?: string; grace?: string; mailer?: MemoryMailer; logLines?: string[] } = {},
): { app: FastifyInstance; mailer: MemoryMailer; ring: MfaKeyring | null } {
  const env: NodeJS.ProcessEnv = {
    DATABASE_URL: 'postgresql://x/x',
    BARA_SERVICE_KEY: KEY,
    ADMIN_MFA_MODE: opts.mode ?? 'enforce',
    BARA_MFA_KEYS: opts.keys ?? `1=${MASTER_V1}`,
    ...(opts.current ? { BARA_MFA_KEY_CURRENT: opts.current } : {}),
    ...(opts.alertTo ? { ADMIN_SECURITY_ALERT_TO: opts.alertTo } : {}),
    ...(opts.grace ? { ADMIN_MFA_GRACE_UNTIL: opts.grace } : {}),
  };
  const config = loadConfig(env);
  const mailer = opts.mailer ?? new MemoryMailer();
  const logLines = opts.logLines;
  const app = buildApp({
    config,
    pool: ctx.pool,
    mailer,
    storage: new MemoryStorage(),
    ...(logLines ? { logger: { level: 'info', stream: { write: (l: string) => void logLines.push(l) } } } : {}),
  });
  return { app, mailer, ring: config.mfa.keyring };
}

let n = 0;
export async function addUser(ctx: Ctx, opts: { admin?: boolean; name?: string } = {}): Promise<{ id: string; email: string }> {
  const email = `mfa${Date.now().toString(36)}${++n}@bara-edu.kr`;
  const r = await ctx.adminPool.query<{ id: string }>(
    'insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3) returning id',
    [email, HASH, JSON.stringify({ name: opts.name ?? `관리자${n}` })],
  );
  const id = r.rows[0].id;
  if (opts.admin) await setRole(ctx, id, 'admin');
  return { id, email };
}

export const setRole = (ctx: Ctx, id: string, role: 'admin' | 'learner') =>
  ctx.adminPool.query(`begin; set local session_replication_role = replica; update profiles set role='${role}' where id='${id}'; commit`);

// 인증 앱 등록을 DB에 바로 만든다(비밀 키를 테스트가 안다). last_used_step = 0.
export async function enrollDirect(ctx: Ctx, ring: MfaKeyring, userId: string, secret: Buffer = Buffer.from('12345678901234567890')): Promise<Buffer> {
  const s = encryptSecret(ring, userId, 'factor', secret);
  await ctx.adminPool.query(
    `insert into auth.mfa_factors (user_id, secret_ciphertext, secret_iv, key_version, confirmed_at, last_used_step, last_used_at, enrolled_via)
     values ($1, $2, $3, $4, now(), 0, now(), 'session')
     on conflict (user_id) do update set secret_ciphertext = excluded.secret_ciphertext, secret_iv = excluded.secret_iv, key_version = excluded.key_version, last_used_step = 0`,
    [userId, s.ciphertext, s.iv, s.keyVersion],
  );
  await ctx.adminPool.query(
    `insert into auth.mfa_account_state (user_id, ever_enrolled_at, ticket_required_at) values ($1, now(), now())
     on conflict (user_id) do update set ever_enrolled_at = coalesce(auth.mfa_account_state.ever_enrolled_at, now()), ticket_required_at = coalesce(auth.mfa_account_state.ticket_required_at, now())`,
    [userId],
  );
  return secret;
}

// 지금 칸(+offset)의 6자리
export const codeAt = (secret: Buffer, offset = 0) => hotp(secret, stepAt(Date.now()) + offset);
export const codeFromB32 = (b32: string, offset = 0) => codeAt(base32Decode(b32), offset);
// 같은 30초 칸에서 번호를 여러 번 쓰는 테스트용: 마지막 사용 칸을 비운다
export const clearLastStep = (ctx: Ctx, userId: string) => ctx.adminPool.query('update auth.mfa_factors set last_used_step = 0 where user_id = $1', [userId]);

export const mfaSession = async (ctx: Ctx, userId: string, method: MfaMethod = 'totp') => (await createSession(ctx.pool as pg.Pool, userId, 30, { mfaMethod: method })).token;

export const flush = () => new Promise<void>((r) => setImmediate(r));

export function caller(app: FastifyInstance) {
  return async (method: 'GET' | 'POST', url: string, payload?: unknown, h: Record<string, string> = {}) => {
    const r = await app.inject({ method, url, payload: payload as object | undefined, headers: { 'x-bara-service-key': KEY, ...h } });
    await flush();
    return r;
  };
}

export const logsOf = async (ctx: Ctx, userId: string) =>
  (await ctx.adminPool.query<{ admin_id: string; target_user_id: string; action: string; detail: string; ip_address: string | null }>(
    'select admin_id, target_user_id, action, detail, ip_address from admin_access_logs where target_user_id = $1 order by created_at, id',
    [userId],
  )).rows;

export const mailsTo = (m: MemoryMailer, to: string) => m.sent.filter((x: MailMessage) => x.to === to);
