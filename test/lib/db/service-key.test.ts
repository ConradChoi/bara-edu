import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const send = vi.fn();
const commands: unknown[] = [];
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    send = send;
  },
  GetParameterCommand: class {
    constructor(public input: unknown) {
      commands.push(input);
    }
  },
}));

import { __resetServiceKeyCache, getPiiRevealSecret, getServiceKey } from '@/lib/db/service-key';

beforeEach(() => {
  __resetServiceKeyCache();
  send.mockReset();
  commands.length = 0;
  delete process.env.BARA_API_SERVICE_KEY;
  delete process.env.BARA_API_SERVICE_KEY_PARAM;
  delete process.env.BARA_PII_REVEAL_SECRET;
  delete process.env.BARA_PII_REVEAL_SECRET_PARAM;
});
afterEach(() => vi.useRealTimers());

test('환경변수가 있으면 SSM을 부르지 않는다', async () => {
  process.env.BARA_API_SERVICE_KEY = 'env-key';
  expect(await getServiceKey()).toBe('env-key');
  expect(send).not.toHaveBeenCalled();
});

test('SSM을 1회 호출하고 캐시하며 동시 호출도 합친다', async () => {
  send.mockResolvedValue({ Parameter: { Value: 'ssm-key' } });
  const [a, b] = await Promise.all([getServiceKey(), getServiceKey()]);
  expect(a).toBe('ssm-key');
  expect(b).toBe('ssm-key');
  expect(await getServiceKey()).toBe('ssm-key');
  expect(send).toHaveBeenCalledTimes(1);
  expect(commands[0]).toEqual({ Name: '/bara-edu/api/service-key', WithDecryption: true });
});

test('파라미터 이름은 환경변수로 바꿀 수 있고 10분 뒤 다시 읽는다', async () => {
  vi.useFakeTimers();
  process.env.BARA_API_SERVICE_KEY_PARAM = '/x/key';
  send.mockResolvedValue({ Parameter: { Value: 'k' } });
  await getServiceKey();
  expect(commands[0]).toEqual({ Name: '/x/key', WithDecryption: true });
  vi.advanceTimersByTime(9 * 60_000);
  await getServiceKey();
  expect(send).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(2 * 60_000);
  await getServiceKey();
  expect(send).toHaveBeenCalledTimes(2);
});

test('SSM 실패 시 throw하고 캐시하지 않는다', async () => {
  send.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ Parameter: { Value: 'k2' } });
  await expect(getServiceKey()).rejects.toThrow();
  expect(await getServiceKey()).toBe('k2');
});

test('값이 비어 있으면 키를 노출하지 않는 오류로 throw', async () => {
  send.mockResolvedValue({ Parameter: {} });
  await expect(getServiceKey()).rejects.toThrow('service key unavailable');
});

test('PII 열람 시크릿: 환경변수가 있으면 SSM을 부르지 않는다', async () => {
  process.env.BARA_PII_REVEAL_SECRET = 'env-pii';
  expect(await getPiiRevealSecret()).toBe('env-pii');
  expect(send).not.toHaveBeenCalled();
});

test('PII 열람 시크릿: 전용 파라미터를 읽고 서비스 키와 캐시를 따로 둔다', async () => {
  send.mockImplementation(async (cmd: { input: { Name: string } }) => ({ Parameter: { Value: `v:${cmd.input.Name}` } }));
  const [a, b] = await Promise.all([getPiiRevealSecret(), getPiiRevealSecret()]);
  expect(a).toBe('v:/bara-edu/app/pii-reveal-secret');
  expect(b).toBe(a);
  expect(await getServiceKey()).toBe('v:/bara-edu/api/service-key');
  expect(await getPiiRevealSecret()).toBe(a);
  expect(send).toHaveBeenCalledTimes(2);
});

test('PII 열람 시크릿: 실패는 고정 문구로 throw하고 캐시하지 않는다', async () => {
  process.env.BARA_PII_REVEAL_SECRET_PARAM = '/x/pii';
  send.mockRejectedValueOnce(new Error('AccessDenied arn:...')).mockResolvedValueOnce({ Parameter: { Value: 'p2' } });
  await expect(getPiiRevealSecret()).rejects.toThrow(/^pii reveal secret unavailable$/);
  expect(await getPiiRevealSecret()).toBe('p2');
  expect(commands.at(-1)).toEqual({ Name: '/x/pii', WithDecryption: true });
});
