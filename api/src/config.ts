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
};

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
const MIN_KEY_BYTES = 32;

export const SERVICE_KEY_ERROR = 'BARA_SERVICE_KEY (or the BARA_SERVICE_KEY_PARAM parameter) is missing or shorter than 32 bytes';
export const PLAINTEXT_WARNING = 'TLS is off in production (BARA_ALLOW_PLAINTEXT=1): WEB to WAS traffic is not encrypted';

function positiveInt(name: string, raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || n > max) throw new Error(`${name} must be a positive integer (max ${max})`);
  return n;
}

// `opts.serviceKey` is the SSM value when BARA_SERVICE_KEY_PARAM is set (secrets.ts); otherwise BARA_SERVICE_KEY is used.
export function loadConfig(env: NodeJS.ProcessEnv, opts: { serviceKey?: string } = {}): Config {
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
  };
}
