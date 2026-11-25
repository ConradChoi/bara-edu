import { expect, test } from 'vitest';
import { clientIpFrom } from '@/lib/db/client-ip';

const from = (h: Record<string, string>) => clientIpFrom((n) => h[n] ?? null);

test('cloudfront-viewer-address가 1순위: IPv4는 포트를 잘라 낸다', () => {
  expect(from({ 'cloudfront-viewer-address': '203.0.113.7:51234', 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' })).toBe('203.0.113.7');
});

test('cloudfront-viewer-address: IPv6 (대괄호 없음/있음)', () => {
  expect(from({ 'cloudfront-viewer-address': '2001:db8::1:51234' })).toBe('2001:db8::1');
  expect(from({ 'cloudfront-viewer-address': '[2001:db8::1]:51234' })).toBe('2001:db8::1');
  expect(from({ 'cloudfront-viewer-address': '2a09:bac2:1234:5678:9abc:def0:1234:5678:443' })).toBe('2a09:bac2:1234:5678:9abc:def0:1234:5678');
});

test('XFF 2순위: 끝에서 두 번째 값 (맨 앞 위조값은 무시)', () => {
  expect(from({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 130.176.1.1' })).toBe('203.0.113.7');
  expect(from({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7, 203.0.113.7, 130.176.1.1' })).toBe('203.0.113.7');
  expect(from({ 'x-forwarded-for': ' 203.0.113.7 , 130.176.1.1 ' })).toBe('203.0.113.7');
});

test('XFF 값이 하나뿐이면 그 값 (로컬 개발)', () => {
  expect(from({ 'x-forwarded-for': '127.0.0.1' })).toBe('127.0.0.1');
});

test('위조: viewer 헤더가 있으면 XFF가 무엇이든 viewer를 쓴다', () => {
  expect(from({ 'cloudfront-viewer-address': '203.0.113.7:1', 'x-forwarded-for': '9.9.9.9' })).toBe('203.0.113.7');
});

test('viewer 헤더가 IP 모양이 아니면 XFF로 넘어간다', () => {
  expect(from({ 'cloudfront-viewer-address': 'garbage', 'x-forwarded-for': '203.0.113.7, 130.176.1.1' })).toBe('203.0.113.7');
});

test('둘 다 없거나 비어 있으면 null, IP가 아닌 값도 null', () => {
  expect(from({})).toBeNull();
  expect(from({ 'x-forwarded-for': '' })).toBeNull();
  expect(from({ 'x-forwarded-for': 'not-an-ip' })).toBeNull();
});
