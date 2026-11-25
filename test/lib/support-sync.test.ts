import { expect, test } from 'vitest';
import { siteConfig } from '@/data/site-config';
import { SUPPORT_HOURS, SUPPORT_PHONE } from '../../api/src/mail/support';

test('API 안내 메일의 문의처와 앱 siteConfig가 같다', () => {
  expect(SUPPORT_PHONE).toBe(siteConfig.phone);
  expect(SUPPORT_HOURS).toBe(siteConfig.supportHours);
  expect(siteConfig.supportHours).toBe('평일 10:00~18:00(점심 11:30~13:00 제외)');
});
