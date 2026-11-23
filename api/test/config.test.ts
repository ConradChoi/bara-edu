import { expect, test } from 'vitest';
import { loadConfig, PLAINTEXT_WARNING, SERVICE_KEY_ERROR } from '../src/config.js';

test('서비스 키가 32자 미만이면 거절', () => {
  expect(() => loadConfig({ DATABASE_URL: 'postgresql://x', BARA_SERVICE_KEY: 'short' })).toThrow(/BARA_SERVICE_KEY/);
});
test('기본값', () => {
  const c = loadConfig({ DATABASE_URL: 'postgresql://x', BARA_SERVICE_KEY: 'k'.repeat(32) });
  expect(c).toMatchObject({ port: 3100, sessionTtlDays: 30, siteOrigins: ['https://bara-edu.kr'], logLevel: 'info' });
});
test('LOG_LEVEL: 지정값 사용, 모르는 값이면 거절', () => {
  const base = { DATABASE_URL: 'postgresql://x', BARA_SERVICE_KEY: 'k'.repeat(32) };
  expect(loadConfig({ ...base, LOG_LEVEL: 'warn' }).logLevel).toBe('warn');
  expect(() => loadConfig({ ...base, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
});
test('PORT·SESSION_TTL_DAYS는 양의 정수만 허용', () => {
  const base = { DATABASE_URL: 'postgresql://x', BARA_SERVICE_KEY: 'k'.repeat(32) };
  expect(loadConfig({ ...base, PORT: '8080', SESSION_TTL_DAYS: '7' })).toMatchObject({ port: 8080, sessionTtlDays: 7 });
  for (const bad of ['abc', '0', '-1', '1.5', '', ' ', '3100x', '70000']) {
    expect(() => loadConfig({ ...base, PORT: bad })).toThrow(/PORT/);
  }
  for (const bad of ['abc', '0', '-3', '2.5', '', '30d']) {
    expect(() => loadConfig({ ...base, SESSION_TTL_DAYS: bad })).toThrow(/SESSION_TTL_DAYS/);
  }
});

const PROD = {
  DATABASE_URL: 'postgresql://x',
  BARA_SERVICE_KEY: 'k'.repeat(32),
  NODE_ENV: 'production',
  MAIL_FROM: 'no-reply@bara-edu.kr',
  S3_BUCKET: 'bucket',
  AWS_REGION: 'ap-northeast-2',
  TLS_CERT_FILE: '/etc/bara-edu/tls/api.crt',
  TLS_KEY_FILE: '/etc/bara-edu/tls/api.key',
};

test('서비스 키는 바이트 기준 32 이상, 없으면 고정 문구로 거절(값은 문구에 없음)', () => {
  expect(() => loadConfig({ DATABASE_URL: 'postgresql://x' })).toThrow(SERVICE_KEY_ERROR);
  // 11 x 3-byte chars = 33 bytes
  expect(loadConfig({ DATABASE_URL: 'postgresql://x', BARA_SERVICE_KEY: '가'.repeat(11) }).serviceKey).toBe('가'.repeat(11));
  const secret = 's'.repeat(31);
  try {
    loadConfig({ DATABASE_URL: 'postgresql://x', BARA_SERVICE_KEY: secret });
    expect.unreachable();
  } catch (err) {
    expect((err as Error).message).toBe(SERVICE_KEY_ERROR);
    expect((err as Error).message).not.toContain(secret);
  }
});

test('opts.serviceKey(SSM 값)가 환경변수보다 우선', () => {
  const c = loadConfig({ DATABASE_URL: 'postgresql://x', BARA_SERVICE_KEY: 'e'.repeat(32) }, { serviceKey: 'p'.repeat(40) });
  expect(c.serviceKey).toBe('p'.repeat(40));
});

test('API_HOST 기본값은 127.0.0.1, TLS는 둘 다 있어야 한다', () => {
  const base = { DATABASE_URL: 'postgresql://x', BARA_SERVICE_KEY: 'k'.repeat(32) };
  expect(loadConfig(base)).toMatchObject({ host: '127.0.0.1', tls: null, plaintextAllowed: false });
  expect(loadConfig({ ...base, API_HOST: '10.0.1.5' }).host).toBe('10.0.1.5');
  expect(loadConfig({ ...base, TLS_CERT_FILE: '/c', TLS_KEY_FILE: '/k' }).tls).toEqual({ certFile: '/c', keyFile: '/k' });
  expect(() => loadConfig({ ...base, TLS_CERT_FILE: '/c' })).toThrow(/TLS_CERT_FILE and TLS_KEY_FILE/);
  expect(() => loadConfig({ ...base, TLS_KEY_FILE: '/k' })).toThrow(/TLS_CERT_FILE and TLS_KEY_FILE/);
});

test('운영: 필수값이 모두 있으면 시작', () => {
  expect(loadConfig(PROD)).toMatchObject({ tls: { certFile: PROD.TLS_CERT_FILE, keyFile: PROD.TLS_KEY_FILE }, plaintextAllowed: false });
});

test('운영: MAIL_FROM·S3_BUCKET·AWS_REGION 중 하나라도 없으면 거절', () => {
  for (const k of ['MAIL_FROM', 'S3_BUCKET', 'AWS_REGION'] as const) {
    expect(() => loadConfig({ ...PROD, [k]: undefined })).toThrow(new RegExp(`requires ${k}`));
    expect(() => loadConfig({ ...PROD, [k]: '' })).toThrow(new RegExp(`requires ${k}`));
  }
});

test('운영: BARA_DEV_FAKES가 있으면 값과 관계없이 거절', () => {
  for (const v of ['1', '0', '']) expect(() => loadConfig({ ...PROD, BARA_DEV_FAKES: v })).toThrow(/BARA_DEV_FAKES/);
});

test('운영: TLS 없으면 거절, BARA_ALLOW_PLAINTEXT=1일 때만 허용(경고 플래그)', () => {
  const noTls = { ...PROD, TLS_CERT_FILE: undefined, TLS_KEY_FILE: undefined };
  expect(() => loadConfig(noTls)).toThrow(/requires TLS_CERT_FILE and TLS_KEY_FILE/);
  expect(() => loadConfig({ ...noTls, BARA_ALLOW_PLAINTEXT: 'true' })).toThrow(/requires TLS_CERT_FILE/);
  expect(loadConfig({ ...noTls, BARA_ALLOW_PLAINTEXT: '1' })).toMatchObject({ tls: null, plaintextAllowed: true });
  expect(PLAINTEXT_WARNING).toMatch(/not encrypted/);
});

test('운영이 아니면 MAIL_FROM 등 없이도 시작(로컬)', () => {
  expect(() => loadConfig({ DATABASE_URL: 'postgresql://x', BARA_SERVICE_KEY: 'k'.repeat(32), NODE_ENV: 'development' })).not.toThrow();
});
