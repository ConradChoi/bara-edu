import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { MFA_PLAINTEXT_KEY_ERROR, SERVICE_KEY_ERROR } from './config.js';
import { decodeMasterKey, makeKeyring, parseVersionList, type MfaKeyring } from './auth/mfa-crypto.js';

type SsmLike = { send(cmd: GetParameterCommand): Promise<{ Parameter?: { Value?: string } }> };

// Reads the service key from SSM Parameter Store (instance role) when BARA_SERVICE_KEY_PARAM is set.
// Returns undefined otherwise, so loadConfig falls back to BARA_SERVICE_KEY (local use).
// Errors are fixed messages: neither the value nor the SDK error text is ever surfaced.
export async function resolveServiceKey(
  env: NodeJS.ProcessEnv,
  makeClient: (region: string) => SsmLike = (region) => new SSMClient({ region }),
): Promise<string | undefined> {
  const name = env.BARA_SERVICE_KEY_PARAM;
  if (!name) return undefined;
  let value: string | undefined;
  try {
    const out = await makeClient(env.AWS_REGION || 'ap-northeast-2').send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    value = out.Parameter?.Value;
  } catch (err) {
    throw new Error(`could not read BARA_SERVICE_KEY_PARAM from SSM (${(err as { name?: string }).name ?? 'error'})`);
  }
  if (!value || Buffer.byteLength(value, 'utf8') < 32) throw new Error(SERVICE_KEY_ERROR);
  return value;
}

// 2단계 인증 마스터 키(기획서 2.6). BARA_MFA_KEY_PARAMS="1=/bara-edu/api/mfa-key-v1,2=..."의 파라미터를 모두 WithDecryption으로 읽고,
// BARA_MFA_KEY_CURRENT(새로 암호화·HMAC할 때 쓰는 버전)가 목록에 있어야 한다. 값이 base64로 정확히 32바이트가 아니면 거절한다.
// BARA_MFA_KEY_PARAMS가 없으면 undefined(로컬은 BARA_MFA_KEYS 평문, 운영은 loadConfig가 거절). 오류 문구에 값·SDK 문구를 넣지 않는다.
export async function resolveMfaKeyring(
  env: NodeJS.ProcessEnv,
  makeClient: (region: string) => SsmLike = (region) => new SSMClient({ region }),
): Promise<MfaKeyring | undefined> {
  if (env.NODE_ENV === 'production' && env.BARA_MFA_KEYS !== undefined) throw new Error(MFA_PLAINTEXT_KEY_ERROR);
  const raw = env.BARA_MFA_KEY_PARAMS;
  if (!raw) return undefined;
  const params = parseVersionList(raw, 'BARA_MFA_KEY_PARAMS');
  const currentRaw = env.BARA_MFA_KEY_CURRENT ?? '';
  if (!/^[1-9][0-9]{0,4}$/.test(currentRaw)) throw new Error('BARA_MFA_KEY_CURRENT must be set to one of the BARA_MFA_KEY_PARAMS versions');
  const client = makeClient(env.AWS_REGION || 'ap-northeast-2');
  const masters = new Map<number, Buffer>();
  for (const [version, name] of params) {
    let value: string | undefined;
    try {
      const out = await client.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
      value = out.Parameter?.Value;
    } catch (err) {
      throw new Error(`could not read MFA key v${version} from SSM (${(err as { name?: string }).name ?? 'error'})`);
    }
    if (!value) throw new Error(`MFA key v${version} is empty`);
    masters.set(version, decodeMasterKey(value, version));
  }
  return makeKeyring(masters, Number(currentRaw));
}
