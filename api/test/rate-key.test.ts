import { expect, test } from 'vitest';
import { rateKeyForIp } from '../src/auth/rate-limit.js';

test('IPv4는 그대로', () => {
  expect(rateKeyForIp('203.0.113.7')).toBe('203.0.113.7');
});

test('IPv4-mapped IPv6는 IPv4 주소 그대로(대소문자·16진 표기 포함)', () => {
  expect(rateKeyForIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
  expect(rateKeyForIp('::FFFF:1.2.3.4')).toBe('1.2.3.4');
  expect(rateKeyForIp('0:0:0:0:0:ffff:1.2.3.4')).toBe('1.2.3.4');
  expect(rateKeyForIp('::ffff:0102:0304')).toBe('1.2.3.4');
});

test('같은 /64의 다른 주소는 같은 키', () => {
  const k = rateKeyForIp('2001:db8:1:2::1');
  expect(k).toBe('2001:db8:1:2::/64');
  expect(rateKeyForIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(k);
  expect(rateKeyForIp('2001:0db8:0001:0002:0000:0000:0000:0001')).toBe(k);
  expect(rateKeyForIp('2001:DB8:1:2:ffff:ffff:ffff:ffff')).toBe(k);
  expect(rateKeyForIp('2001:db8:1:2::')).toBe(k);
});

test('다른 /64는 다른 키', () => {
  expect(rateKeyForIp('2001:db8:1:3::1')).not.toBe(rateKeyForIp('2001:db8:1:2::1'));
  expect(rateKeyForIp('2001:db8:2:2::1')).not.toBe(rateKeyForIp('2001:db8:1:2::1'));
});

test('축약 표기(::)가 앞 64비트 안에 걸쳐도 처리한다', () => {
  expect(rateKeyForIp('2001:db8::1')).toBe('2001:db8:0:0::/64');
  expect(rateKeyForIp('2001:db8:0:0:5::1')).toBe('2001:db8:0:0::/64');
  expect(rateKeyForIp('::1')).toBe('0:0:0:0::/64');
  expect(rateKeyForIp('::')).toBe('0:0:0:0::/64');
  expect(rateKeyForIp('2001::')).toBe('2001:0:0:0::/64');
  expect(rateKeyForIp('1:2:3:4:5:6:7::')).toBe('1:2:3:4::/64');
});

test('zone id와 대괄호는 무시한다', () => {
  expect(rateKeyForIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  expect(rateKeyForIp('fe80::2%en1')).toBe(rateKeyForIp('fe80::1%eth0'));
  expect(rateKeyForIp('[2001:db8:1:2::9]')).toBe('2001:db8:1:2::/64');
});

test('끝이 IPv4 표기인 IPv6도 앞 64비트로 묶는다', () => {
  expect(rateKeyForIp('2001:db8:1:2::1.2.3.4')).toBe('2001:db8:1:2::/64');
});

test('IP 모양이 아닌 값은 그대로(기존 동작)', () => {
  expect(rateKeyForIp('not-an-ip')).toBe('not-an-ip');
});
