import { expect, test } from 'vitest';
import nextConfig, { CONFIRM_PAGE_HEADERS, MFA_PAGE_PATHS } from '@/next.config';

test('/auth/confirm 응답 헤더: Cache-Control private, no-store / Referrer-Policy no-referrer / X-Robots-Tag noindex', async () => {
  const rules = await nextConfig.headers!();
  const rule = rules.find((r) => r.source === '/auth/confirm');
  expect(rule).toBeDefined();
  const h = Object.fromEntries(rule!.headers.map((x) => [x.key, x.value]));
  expect(h).toEqual({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' });
});

test('/reset-password 응답 헤더: 토큰이 URL에 있어 /auth/confirm과 같은 헤더(no-store·no-referrer·noindex)', async () => {
  const rules = await nextConfig.headers!();
  const rule = rules.find((r) => r.source === '/reset-password');
  expect(rule).toBeDefined();
  const h = Object.fromEntries(rule!.headers.map((x) => [x.key, x.value]));
  expect(h).toEqual({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' });
  expect(rule!.headers).toBe(CONFIRM_PAGE_HEADERS);
});

test('/forgot-password 응답 헤더: no-store·noindex (URL에 토큰·이메일이 없어 Referer 규칙은 없다)', async () => {
  const rules = await nextConfig.headers!();
  const rule = rules.find((r) => r.source === '/forgot-password');
  expect(rule).toBeDefined();
  const h = Object.fromEntries(rule!.headers.map((x) => [x.key, x.value]));
  expect(h).toEqual({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' });
});

test('헤더 규칙은 정해 둔 경로에만 건다', async () => {
  const rules = await nextConfig.headers!();
  expect(rules.map((r) => r.source)).toEqual(['/auth/confirm', '/reset-password', '/forgot-password', '/sign-in/otp', '/sign-in/recovery', '/sign-in/otp-setup', '/admin/security']);
});

test('2단계 인증 화면(로그인 2단계·복구 코드·등록·내 보안 설정): no-store·no-referrer·noindex (기획서 3장 공통 규칙)', async () => {
  const rules = await nextConfig.headers!();
  expect(MFA_PAGE_PATHS).toEqual(['/sign-in/otp', '/sign-in/recovery', '/sign-in/otp-setup', '/admin/security']);
  for (const path of MFA_PAGE_PATHS) {
    const rule = rules.find((r) => r.source === path);
    expect(rule, path).toBeDefined();
    expect(rule!.headers).toBe(CONFIRM_PAGE_HEADERS);
    expect(Object.fromEntries(rule!.headers.map((x) => [x.key, x.value]))).toEqual({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' });
  }
});
