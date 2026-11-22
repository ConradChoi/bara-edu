import 'server-only';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const TTL_MS = 10 * 60_000;

type SecretSpec = { env: string; paramEnv: string; defaultParam: string; errorMessage: string; minBytes?: number };

function secretReader({ env, paramEnv, defaultParam, errorMessage, minBytes = 1 }: SecretSpec) {
  const usable = (v: string | undefined): v is string => !!v && Buffer.byteLength(v, 'utf8') >= minBytes;

  let cached: { value: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  async function fetchFromSsm(): Promise<string> {
    const client = new SSMClient({});
    const out = await client.send(
      new GetParameterCommand({ Name: process.env[paramEnv] ?? defaultParam, WithDecryption: true }),
    );
    const value = out.Parameter?.Value;
    if (!usable(value)) throw new Error(errorMessage);
    return value;
  }

  return {
    async get(): Promise<string> {
      const fromEnv = process.env[env];
      if (fromEnv) {
        if (!usable(fromEnv)) throw new Error(errorMessage);
        return fromEnv;
      }
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      inflight ??= fetchFromSsm()
        .then((value) => {
          cached = { value, expiresAt: Date.now() + TTL_MS };
          return value;
        })
        .catch(() => {
          // 원인 오류에 요청 세부가 섞이지 않도록 고정 문구로 바꾼다.
          throw new Error(errorMessage);
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    reset(): void {
      cached = null;
      inflight = null;
    },
  };
}

const serviceKey = secretReader({
  env: 'BARA_API_SERVICE_KEY',
  paramEnv: 'BARA_API_SERVICE_KEY_PARAM',
  defaultParam: '/bara-edu/api/service-key',
  errorMessage: 'service key unavailable',
});

const piiRevealSecret = secretReader({
  env: 'BARA_PII_REVEAL_SECRET',
  paramEnv: 'BARA_PII_REVEAL_SECRET_PARAM',
  defaultParam: '/bara-edu/app/pii-reveal-secret',
  errorMessage: 'pii reveal secret unavailable',
  // HMAC-SHA256 key: shorter than the hash output weakens the token signature
  minBytes: 32,
});

export function getServiceKey(): Promise<string> {
  return serviceKey.get();
}

export function getPiiRevealSecret(): Promise<string> {
  return piiRevealSecret.get();
}

export function __resetServiceKeyCache(): void {
  serviceKey.reset();
  piiRevealSecret.reset();
}
