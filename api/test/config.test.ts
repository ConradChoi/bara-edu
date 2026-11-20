import { expect, test } from 'vitest';
import { loadConfig } from '../src/config.js';

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
