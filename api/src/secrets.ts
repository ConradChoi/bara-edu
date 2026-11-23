import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { SERVICE_KEY_ERROR } from './config.js';

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
