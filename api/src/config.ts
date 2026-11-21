export type Config = {
  databaseUrl: string;
  serviceKey: string;
  port: number;
  sessionTtlDays: number;
  siteOrigins: string[];
  logLevel: string;
  s3Bucket: string | null;
  awsRegion: string;
};

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

function positiveInt(name: string, raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || n > max) throw new Error(`${name} must be a positive integer (max ${max})`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const serviceKey = env.BARA_SERVICE_KEY;
  if (!serviceKey || serviceKey.length < 32) throw new Error('BARA_SERVICE_KEY must be at least 32 characters');
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);
  return {
    databaseUrl,
    serviceKey,
    port: positiveInt('PORT', env.PORT, 3100, 65535),
    sessionTtlDays: positiveInt('SESSION_TTL_DAYS', env.SESSION_TTL_DAYS, 30, 3650),
    siteOrigins: (env.SITE_ORIGINS ?? 'https://bara-edu.kr')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    logLevel,
    s3Bucket: env.S3_BUCKET || null,
    awsRegion: env.AWS_REGION || 'ap-northeast-2',
  };
}
