import { expect, test } from 'vitest';
import type { GetParameterCommand } from '@aws-sdk/client-ssm';
import { resolveServiceKey } from '../src/secrets.js';
import { SERVICE_KEY_ERROR } from '../src/config.js';

function fakeSsm(result: () => Promise<{ Parameter?: { Value?: string } }>) {
  const calls: { region: string; input: GetParameterCommand['input'] }[] = [];
  const make = (region: string) => ({
    send: async (cmd: GetParameterCommand) => {
      calls.push({ region, input: cmd.input });
      return result();
    },
  });
  return { calls, make };
}

const KEY = 'x'.repeat(48);

test('BARA_SERVICE_KEY_PARAM이 없으면 SSM을 부르지 않고 undefined(환경변수 사용)', async () => {
  const ssm = fakeSsm(async () => ({ Parameter: { Value: KEY } }));
  expect(await resolveServiceKey({ BARA_SERVICE_KEY: 'e'.repeat(32) }, ssm.make)).toBeUndefined();
  expect(ssm.calls).toHaveLength(0);
});

test('파라미터를 WithDecryption으로 읽어 값을 돌려준다', async () => {
  const ssm = fakeSsm(async () => ({ Parameter: { Value: KEY } }));
  const v = await resolveServiceKey({ BARA_SERVICE_KEY_PARAM: '/bara-edu/api/service-key', AWS_REGION: 'ap-northeast-2' }, ssm.make);
  expect(v).toBe(KEY);
  expect(ssm.calls).toEqual([{ region: 'ap-northeast-2', input: { Name: '/bara-edu/api/service-key', WithDecryption: true } }]);
});

test('값이 없거나 32바이트 미만이면 고정 문구로 실패(값은 문구에 없음)', async () => {
  for (const Value of [undefined, '', 'short-secret-value-31-bytes-xxxx'.slice(0, 31)]) {
    const ssm = fakeSsm(async () => ({ Parameter: { Value } }));
    const err = await resolveServiceKey({ BARA_SERVICE_KEY_PARAM: '/p' }, ssm.make).catch((e: Error) => e);
    expect((err as Error).message).toBe(SERVICE_KEY_ERROR);
    if (Value) expect((err as Error).message).not.toContain(Value);
  }
});

test('SSM 호출 실패는 오류 이름만 담은 고정 문구', async () => {
  const ssm = fakeSsm(async () => {
    const e = new Error('AccessDenied for arn:aws:iam::123:role/x secret=abc');
    e.name = 'AccessDeniedException';
    throw e;
  });
  const err = (await resolveServiceKey({ BARA_SERVICE_KEY_PARAM: '/p' }, ssm.make).catch((e: Error) => e)) as Error;
  expect(err.message).toBe('could not read BARA_SERVICE_KEY_PARAM from SSM (AccessDeniedException)');
  expect(err.message).not.toContain('secret');
});
