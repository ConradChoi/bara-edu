import { decodeMasterKey, makeKeyring, parseVersionList, type MfaKeyring } from './auth/mfa-crypto.js';

export type MfaMode = 'off' | 'optional' | 'enforce';
export const MFA_MODES: readonly MfaMode[] = ['off', 'optional', 'enforce'];

// 관리자 2단계 인증 설정(기획서 2.6·2.13·2.14). keyring이 null이면(로컬·테스트에서 키를 주지 않음) 2단계 인증 API는 503을 준다.
export type MfaConfig = { mode: MfaMode; graceUntil: string | null; alertTo: string[]; keyring: MfaKeyring | null };

export type Config = {
  databaseUrl: string;
  serviceKey: string;
  port: number;
  host: string;
  sessionTtlDays: number;
  siteOrigins: string[];
  logLevel: string;
  s3Bucket: string | null;
  awsRegion: string;
  tls: { certFile: string; keyFile: string } | null;
  // production without TLS, explicitly allowed by BARA_ALLOW_PLAINTEXT=1: the server logs PLAINTEXT_WARNING
  plaintextAllowed: boolean;
  mfa: MfaConfig;
};

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
const MIN_KEY_BYTES = 32;

export const SERVICE_KEY_ERROR = 'BARA_SERVICE_KEY (or the BARA_SERVICE_KEY_PARAM parameter) is missing or shorter than 32 bytes';
export const MFA_MODE_ERROR = 'ADMIN_MFA_MODE must be one of off, optional, enforce (required in production)';
export const MFA_KEY_REQUIRED_ERROR = 'NODE_ENV=production requires BARA_MFA_KEY_PARAMS and BARA_MFA_KEY_CURRENT (SSM)';
export const MFA_PLAINTEXT_KEY_ERROR = 'BARA_MFA_KEYS (plaintext key) must not be set in production; use BARA_MFA_KEY_PARAMS';
export const PLAINTEXT_WARNING = 'TLS is off in production (BARA_ALLOW_PLAINTEXT=1): WEB to WAS traffic is not encrypted';

function positiveInt(name: string, raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || n > max) throw new Error(`${name} must be a positive integer (max ${max})`);
  return n;
}

// ISO 8601 시각(오프셋 필수). 예: 2026-12-03T00:00:00+09:00
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const MAX_ALERT_TO = 5;

// 로컬·테스트 전용 평문 키(BARA_MFA_KEYS="1=<base64>"). 운영에서는 loadConfig가 거절한다.
export function keyringFromPlainEnv(env: NodeJS.ProcessEnv): MfaKeyring | null {
  const raw = env.BARA_MFA_KEYS;
  if (raw === undefined || raw === '') return null;
  const list = parseVersionList(raw, 'BARA_MFA_KEYS');
  const masters = new Map([...list].map(([v, b64]) => [v, decodeMasterKey(b64, v)] as const));
  const current = env.BARA_MFA_KEY_CURRENT ? Number(env.BARA_MFA_KEY_CURRENT) : Math.max(...masters.keys());
  return makeKeyring(masters, current);
}

function loadMfa(env: NodeJS.ProcessEnv, prod: boolean, keyring: MfaKeyring | undefined): MfaConfig {
  const rawMode = env.ADMIN_MFA_MODE;
  // 운영: 값이 없거나 셋 중 하나가 아니면 시작 거절(실패 시 닫힘, 보안 점검 I-3). 개발·테스트: 없으면 enforce, 오타는 거절.
  if (rawMode === undefined && prod) throw new Error(MFA_MODE_ERROR);
  const mode = (rawMode ?? 'enforce') as MfaMode;
  if (!MFA_MODES.includes(mode)) throw new Error(MFA_MODE_ERROR);

  const rawGrace = env.ADMIN_MFA_GRACE_UNTIL;
  let graceUntil: string | null = null;
  if (rawGrace !== undefined && rawGrace !== '') {
    if (!ISO_WITH_OFFSET.test(rawGrace) || Number.isNaN(Date.parse(rawGrace))) throw new Error('ADMIN_MFA_GRACE_UNTIL must be an ISO 8601 time with offset (e.g. 2026-12-03T00:00:00+09:00)');
    graceUntil = rawGrace;
  }
  if (prod && mode === 'optional' && graceUntil === null) throw new Error('ADMIN_MFA_MODE=optional requires ADMIN_MFA_GRACE_UNTIL in production');

  const alertTo: string[] = [];
  for (const a of (env.ADMIN_SECURITY_ALERT_TO ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (!EMAIL_RE.test(a) || a.length > 254) throw new Error('ADMIN_SECURITY_ALERT_TO must be a comma-separated list of email addresses');
    if (!alertTo.includes(a)) alertTo.push(a);
  }
  if (alertTo.length > MAX_ALERT_TO) throw new Error(`ADMIN_SECURITY_ALERT_TO allows at most ${MAX_ALERT_TO} addresses`);
  // 운영에서는 비울 수 없다(2026-11-27, TOTP 후속 보안 점검 R-1·I-A): 비면 보안 알림이 "탈취됐을 수 있는 메일함" 하나로만 가거나(관리자 1명)
  // CLI mfa-ticket·mfa-unlock 알림이 아무에게도 가지 않는다.
  if (prod && alertTo.length === 0) throw new Error('ADMIN_SECURITY_ALERT_TO is required in production');

  // 운영: 평문 키 변수가 있으면 거절, SSM 키가 없으면 거절(모드와 관계없이 — 등록 코드가 필요한 계정은 off에서도 키가 있어야 등록할 수 있다).
  if (prod && env.BARA_MFA_KEYS !== undefined) throw new Error(MFA_PLAINTEXT_KEY_ERROR);
  if (prod && !keyring) throw new Error(MFA_KEY_REQUIRED_ERROR);
  return { mode, graceUntil, alertTo, keyring: keyring ?? (prod ? null : keyringFromPlainEnv(env)) };
}

// `opts.serviceKey` is the SSM value when BARA_SERVICE_KEY_PARAM is set (secrets.ts); otherwise BARA_SERVICE_KEY is used.
// `opts.mfaKeyring` is the SSM key ring when BARA_MFA_KEY_PARAMS is set (secrets.ts resolveMfaKeyring).
export function loadConfig(env: NodeJS.ProcessEnv, opts: { serviceKey?: string; mfaKeyring?: MfaKeyring } = {}): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const serviceKey = opts.serviceKey ?? env.BARA_SERVICE_KEY;
  if (!serviceKey || Buffer.byteLength(serviceKey, 'utf8') < MIN_KEY_BYTES) throw new Error(SERVICE_KEY_ERROR);
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);

  const certFile = env.TLS_CERT_FILE || '';
  const keyFile = env.TLS_KEY_FILE || '';
  if (!!certFile !== !!keyFile) throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be set together');
  const tls = certFile ? { certFile, keyFile } : null;

  let plaintextAllowed = false;
  if (env.NODE_ENV === 'production') {
    const missing = ['MAIL_FROM', 'S3_BUCKET', 'AWS_REGION'].filter((k) => !env[k]);
    if (missing.length) throw new Error(`NODE_ENV=production requires ${missing.join(', ')}`);
    if (env.BARA_DEV_FAKES !== undefined) throw new Error('BARA_DEV_FAKES must not be set in production');
    if (!tls) {
      if (env.BARA_ALLOW_PLAINTEXT !== '1') {
        throw new Error('NODE_ENV=production requires TLS_CERT_FILE and TLS_KEY_FILE (or BARA_ALLOW_PLAINTEXT=1)');
      }
      plaintextAllowed = true;
    }
  }

  return {
    databaseUrl,
    serviceKey,
    port: positiveInt('PORT', env.PORT, 3100, 65535),
    host: env.API_HOST || '127.0.0.1',
    sessionTtlDays: positiveInt('SESSION_TTL_DAYS', env.SESSION_TTL_DAYS, 30, 3650),
    siteOrigins: (env.SITE_ORIGINS ?? 'https://bara-edu.kr')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    logLevel,
    s3Bucket: env.S3_BUCKET || null,
    awsRegion: env.AWS_REGION || 'ap-northeast-2',
    tls,
    plaintextAllowed,
    mfa: loadMfa(env, env.NODE_ENV === 'production', opts.mfaKeyring),
  };
}
