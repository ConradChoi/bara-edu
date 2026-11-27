import { expect, test } from 'vitest';
import type { GetParameterCommand } from '@aws-sdk/client-ssm';
import { codeHmac, decodeMasterKey, decryptSecret, encryptSecret, makeKeyring, parseVersionList } from '../src/auth/mfa-crypto.js';
import { keyringFromPlainEnv, loadConfig, MFA_KEY_REQUIRED_ERROR, MFA_MODE_ERROR, MFA_PLAINTEXT_KEY_ERROR } from '../src/config.js';
import { resolveMfaKeyring } from '../src/secrets.js';

const K1 = Buffer.alloc(32, 1);
const K2 = Buffer.alloc(32, 2);
const ring = makeKeyring(new Map([[1, K1], [2, K2]]), 2);
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const SECRET = Buffer.from('12345678901234567890');

test('AES-256-GCM: 왕복, 암호화할 때마다 새 IV, 현재 키 버전', () => {
  const a = encryptSecret(ring, U1, 'factor', SECRET);
  const b = encryptSecret(ring, U1, 'factor', SECRET);
  expect(a.keyVersion).toBe(2);
  expect(a.iv).toHaveLength(12);
  expect(a.iv.equals(b.iv)).toBe(false);
  expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  expect(decryptSecret(ring, U1, 'factor', a).equals(SECRET)).toBe(true);
  expect(a.ciphertext.includes(SECRET)).toBe(false);
});

test('AAD(보안 점검 M-4): 등록 대기 암호문을 factor로, 다른 사용자로, 다른 버전으로 옮기면 풀리지 않는다', () => {
  const e = encryptSecret(ring, U1, 'enrollment', SECRET);
  expect(() => decryptSecret(ring, U1, 'factor', e)).toThrow(/authenticate/);
  expect(() => decryptSecret(ring, U2, 'enrollment', e)).toThrow(/authenticate/);
  expect(() => decryptSecret(ring, U1, 'enrollment', { ...e, keyVersion: 1 })).toThrow(/authenticate/);
  expect(decryptSecret(ring, U1, 'enrollment', e).equals(SECRET)).toBe(true);
});

test('HKDF 하위 키: 용도·버전마다 다르고, HMAC은 버전별로 다르다', () => {
  const keys = [ring.subkey(1, 'totp-secret'), ring.subkey(1, 'recovery-code'), ring.subkey(1, 'enroll-ticket'), ring.subkey(1, 'key-check'), ring.subkey(2, 'totp-secret')];
  expect(new Set(keys.map((k) => k.toString('hex'))).size).toBe(5);
  expect(codeHmac(ring, 1, 'recovery-code', 'ABCDEFGHJK').equals(codeHmac(ring, 2, 'recovery-code', 'ABCDEFGHJK'))).toBe(false);
  expect(codeHmac(ring, 1, 'recovery-code', '12345678').equals(codeHmac(ring, 1, 'enroll-ticket', '12345678'))).toBe(false);
  expect(() => ring.subkey(3, 'totp-secret')).toThrow(/not loaded/);
});

test('마스터 키는 base64로 정확히 32바이트(보안 점검 M-6), 오류 문구에 값이 없다', () => {
  expect(decodeMasterKey(K1.toString('base64'), 1).equals(K1)).toBe(true);
  for (const bad of [Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'), 'not base64!!', '']) {
    try {
      decodeMasterKey(bad, 1);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/v1/);
      if (bad) expect((e as Error).message).not.toContain(bad);
    }
  }
});

test('버전 목록 형식: "1=..,2=..", 중복·0·이상한 형식 거절, 현재 버전은 목록에 있어야 한다', () => {
  expect([...parseVersionList('1=/a, 2=/b', 'X')]).toEqual([[1, '/a'], [2, '/b']]);
  for (const bad of ['', '=a', '0=a', '1=', '1=a,1=b', 'x=a', '1:a']) expect(() => parseVersionList(bad, 'X')).toThrow();
  expect(() => makeKeyring(new Map([[1, K1]]), 2)).toThrow(/BARA_MFA_KEY_CURRENT/);
});

// ---- 설정(기획서 2.6·2.14, 보안 점검 I-3·M-6)

const BASE = { DATABASE_URL: 'postgresql://x', BARA_SERVICE_KEY: 'k'.repeat(32) };
const PROD = {
  ...BASE,
  NODE_ENV: 'production',
  MAIL_FROM: 'no-reply@bara-edu.kr',
  S3_BUCKET: 'b',
  AWS_REGION: 'ap-northeast-2',
  TLS_CERT_FILE: '/c',
  TLS_KEY_FILE: '/k',
  ADMIN_MFA_MODE: 'enforce',
  ADMIN_SECURITY_ALERT_TO: 'dev@example.com',
};
const RING1 = makeKeyring(new Map([[1, K1]]), 1);

test('I-3 운영에서 ADMIN_MFA_MODE가 없거나 셋 중 하나가 아니면 시작 거절(실패 시 닫힘)', () => {
  expect(() => loadConfig({ ...PROD, ADMIN_MFA_MODE: undefined }, { mfaKeyring: RING1 })).toThrow(MFA_MODE_ERROR);
  for (const bad of ['', 'Enforce', 'enforce ', 'on', 'disabled']) expect(() => loadConfig({ ...PROD, ADMIN_MFA_MODE: bad }, { mfaKeyring: RING1 })).toThrow(MFA_MODE_ERROR);
  for (const m of ['off', 'optional', 'enforce']) {
    const c = loadConfig({ ...PROD, ADMIN_MFA_MODE: m, ADMIN_MFA_GRACE_UNTIL: '2026-12-03T00:00:00+09:00' }, { mfaKeyring: RING1 });
    expect(c.mfa.mode).toBe(m);
  }
});

test('개발·테스트에서 모드가 없으면 enforce, 오타는 거절', () => {
  expect(loadConfig(BASE).mfa.mode).toBe('enforce');
  expect(() => loadConfig({ ...BASE, ADMIN_MFA_MODE: 'opitonal' })).toThrow(MFA_MODE_ERROR);
});

test('운영 optional은 ADMIN_MFA_GRACE_UNTIL(오프셋 있는 ISO 시각)이 필요하다', () => {
  expect(() => loadConfig({ ...PROD, ADMIN_MFA_MODE: 'optional' }, { mfaKeyring: RING1 })).toThrow(/ADMIN_MFA_GRACE_UNTIL/);
  for (const bad of ['2026-12-03', '2026-12-03T00:00:00', 'tomorrow', '2026-13-40T00:00:00+09:00x']) {
    expect(() => loadConfig({ ...PROD, ADMIN_MFA_MODE: 'optional', ADMIN_MFA_GRACE_UNTIL: bad }, { mfaKeyring: RING1 })).toThrow(/ADMIN_MFA_GRACE_UNTIL/);
  }
  const c = loadConfig({ ...PROD, ADMIN_MFA_MODE: 'optional', ADMIN_MFA_GRACE_UNTIL: '2026-12-03T00:00:00+09:00' }, { mfaKeyring: RING1 });
  expect(c.mfa.graceUntil).toBe('2026-12-03T00:00:00+09:00');
});

test('운영: SSM 키 링이 없으면 모드와 관계없이 시작 거절(off 포함)', () => {
  for (const m of ['off', 'enforce']) expect(() => loadConfig({ ...PROD, ADMIN_MFA_MODE: m })).toThrow(MFA_KEY_REQUIRED_ERROR);
});

test('운영: 평문 BARA_MFA_KEYS가 있으면 시작 거절(loadConfig와 resolveMfaKeyring 둘 다)', async () => {
  expect(() => loadConfig({ ...PROD, BARA_MFA_KEYS: `1=${K1.toString('base64')}` }, { mfaKeyring: RING1 })).toThrow(MFA_PLAINTEXT_KEY_ERROR);
  await expect(resolveMfaKeyring({ ...PROD, BARA_MFA_KEYS: 'x' })).rejects.toThrow(MFA_PLAINTEXT_KEY_ERROR);
});

test('로컬: BARA_MFA_KEYS 평문 키 링(현재 버전 기본 = 가장 큰 버전), 32바이트 아니면 거절', () => {
  const r = keyringFromPlainEnv({ BARA_MFA_KEYS: `1=${K1.toString('base64')},2=${K2.toString('base64')}` })!;
  expect(r.current).toBe(2);
  expect(r.versions).toEqual([1, 2]);
  expect(() => loadConfig({ ...BASE, BARA_MFA_KEYS: `1=${Buffer.alloc(16).toString('base64')}` })).toThrow(/32 bytes/);
  expect(loadConfig(BASE).mfa.keyring).toBeNull();
});

test('ADMIN_SECURITY_ALERT_TO: 쉼표로 최대 5개, 형식이 틀리면 거절, 소문자·중복 제거', () => {
  expect(loadConfig({ ...BASE, ADMIN_SECURITY_ALERT_TO: ' Dev@Bara-Edu.kr, ops@x.kr,dev@bara-edu.kr ' }).mfa.alertTo).toEqual(['dev@bara-edu.kr', 'ops@x.kr']);
  expect(() => loadConfig({ ...BASE, ADMIN_SECURITY_ALERT_TO: 'not-an-email' })).toThrow(/ADMIN_SECURITY_ALERT_TO/);
  expect(() => loadConfig({ ...BASE, ADMIN_SECURITY_ALERT_TO: 'a@x.kr,b@x.kr,c@x.kr,d@x.kr,e@x.kr,f@x.kr' })).toThrow(/at most 5/);
  expect(() => loadConfig({ ...PROD, ADMIN_SECURITY_ALERT_TO: 'a@x.kr;b@x.kr' }, { mfaKeyring: RING1 })).toThrow(/ADMIN_SECURITY_ALERT_TO/);
});

function fakeSsm(values: Record<string, string | undefined | Error>) {
  const calls: GetParameterCommand['input'][] = [];
  return {
    calls,
    make: () => ({
      send: async (cmd: GetParameterCommand) => {
        calls.push(cmd.input);
        const v = values[cmd.input.Name!];
        if (v instanceof Error) throw v;
        return { Parameter: { Value: v } };
      },
    }),
  };
}

test('SSM: 목록의 파라미터를 모두 WithDecryption으로 읽고 현재 버전을 고른다', async () => {
  const ssm = fakeSsm({ '/bara-edu/api/mfa-key-v1': K1.toString('base64'), '/bara-edu/api/mfa-key-v2': K2.toString('base64') });
  const r = await resolveMfaKeyring({ BARA_MFA_KEY_PARAMS: '1=/bara-edu/api/mfa-key-v1,2=/bara-edu/api/mfa-key-v2', BARA_MFA_KEY_CURRENT: '2' }, ssm.make);
  expect(r!.current).toBe(2);
  expect(ssm.calls).toEqual([
    { Name: '/bara-edu/api/mfa-key-v1', WithDecryption: true },
    { Name: '/bara-edu/api/mfa-key-v2', WithDecryption: true },
  ]);
  expect(await resolveMfaKeyring({}, ssm.make)).toBeUndefined();
});

test('SSM: 현재 버전 없음·목록 밖, 값 없음, 32바이트 아님, 호출 실패는 거절(값·SDK 문구 없음)', async () => {
  const good = fakeSsm({ '/p1': K1.toString('base64') });
  await expect(resolveMfaKeyring({ BARA_MFA_KEY_PARAMS: '1=/p1' }, good.make)).rejects.toThrow(/BARA_MFA_KEY_CURRENT/);
  await expect(resolveMfaKeyring({ BARA_MFA_KEY_PARAMS: '1=/p1', BARA_MFA_KEY_CURRENT: '2' }, good.make)).rejects.toThrow(/BARA_MFA_KEY_CURRENT/);
  await expect(resolveMfaKeyring({ BARA_MFA_KEY_PARAMS: '1=/p1', BARA_MFA_KEY_CURRENT: '1' }, fakeSsm({ '/p1': undefined }).make)).rejects.toThrow(/empty/);
  const short = Buffer.alloc(31, 9).toString('base64');
  const e = (await resolveMfaKeyring({ BARA_MFA_KEY_PARAMS: '1=/p1', BARA_MFA_KEY_CURRENT: '1' }, fakeSsm({ '/p1': short }).make).catch((x: Error) => x)) as Error;
  expect(e.message).toMatch(/32 bytes/);
  expect(e.message).not.toContain(short);
  const boom = Object.assign(new Error('AccessDenied secret=abc'), { name: 'AccessDeniedException' });
  const e2 = (await resolveMfaKeyring({ BARA_MFA_KEY_PARAMS: '1=/p1', BARA_MFA_KEY_CURRENT: '1' }, fakeSsm({ '/p1': boom }).make).catch((x: Error) => x)) as Error;
  expect(e2.message).toBe('could not read MFA key v1 from SSM (AccessDeniedException)');
});

test('R-1 운영에서 ADMIN_SECURITY_ALERT_TO가 비면 시작 거절(비운영은 허용)', () => {
  const { ADMIN_SECURITY_ALERT_TO: _drop, ...noAlert } = PROD;
  expect(() => loadConfig(noAlert, { mfaKeyring: RING1 })).toThrow(/ADMIN_SECURITY_ALERT_TO is required in production/);
  expect(() => loadConfig({ ...noAlert, ADMIN_SECURITY_ALERT_TO: ' , ' }, { mfaKeyring: RING1 })).toThrow(/required in production/);
  expect(loadConfig({ ...PROD }, { mfaKeyring: RING1 }).mfa.alertTo).toEqual(['dev@example.com']);
  expect(loadConfig({ ...BASE }).mfa.alertTo).toEqual([]);
});
