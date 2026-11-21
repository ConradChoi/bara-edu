import 'server-only';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const TTL_MS = 10 * 60_000;
let cached: { value: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

async function fetchFromSsm(): Promise<string> {
  const client = new SSMClient({});
  const out = await client.send(
    new GetParameterCommand({
      Name: process.env.BARA_API_SERVICE_KEY_PARAM ?? '/bara-edu/api/service-key',
      WithDecryption: true,
    }),
  );
  const value = out.Parameter?.Value;
  if (!value) throw new Error('service key unavailable');
  return value;
}

export async function getServiceKey(): Promise<string> {
  const fromEnv = process.env.BARA_API_SERVICE_KEY;
  if (fromEnv) return fromEnv;
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  inflight ??= fetchFromSsm()
    .then((value) => {
      cached = { value, expiresAt: Date.now() + TTL_MS };
      return value;
    })
    .catch(() => {
      // 원인 오류에 요청 세부가 섞이지 않도록 고정 문구로 바꾼다.
      throw new Error('service key unavailable');
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function __resetServiceKeyCache(): void {
  cached = null;
  inflight = null;
}
