import { expect, test } from 'vitest';
import nextConfig from '@/next.config';

test('/auth/confirm 응답 헤더: Cache-Control private, no-store / Referrer-Policy no-referrer / X-Robots-Tag noindex', async () => {
  const rules = await nextConfig.headers!();
  const rule = rules.find((r) => r.source === '/auth/confirm');
  expect(rule).toBeDefined();
  const h = Object.fromEntries(rule!.headers.map((x) => [x.key, x.value]));
  expect(h).toEqual({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' });
});

test('가입 링크 경로 말고 다른 경로에는 이 헤더 규칙을 걸지 않는다', async () => {
  const rules = await nextConfig.headers!();
  expect(rules.map((r) => r.source)).toEqual(['/auth/confirm']);
});
