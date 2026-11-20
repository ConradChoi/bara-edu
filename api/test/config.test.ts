import { expect, test } from 'vitest';
import { loadConfig } from '../src/config.js';

test('서비스 키가 32자 미만이면 거절', () => {
  expect(() => loadConfig({ DATABASE_URL: 'postgresql://x', BARA_SERVICE_KEY: 'short' })).toThrow(/BARA_SERVICE_KEY/);
});
test('기본값', () => {
  const c = loadConfig({ DATABASE_URL: 'postgresql://x', BARA_SERVICE_KEY: 'k'.repeat(32) });
  expect(c).toMatchObject({ port: 3100, sessionTtlDays: 30, siteOrigins: ['https://bara-edu.kr'] });
});
