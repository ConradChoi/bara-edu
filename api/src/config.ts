export type Config = {
  databaseUrl: string;
  serviceKey: string;
  port: number;
  sessionTtlDays: number;
  siteOrigins: string[];
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const serviceKey = env.BARA_SERVICE_KEY;
  if (!serviceKey || serviceKey.length < 32) throw new Error('BARA_SERVICE_KEY must be at least 32 characters');
  return {
    databaseUrl,
    serviceKey,
    port: Number(env.PORT ?? 3100),
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
    siteOrigins: (env.SITE_ORIGINS ?? 'https://bara-edu.kr')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
