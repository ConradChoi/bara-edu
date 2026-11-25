import { expect, test } from 'vitest';
import { WITHDRAWAL_REASONS } from '@/data/account-settings';
import { WITHDRAWAL_REASON_KEYS } from '../../api/src/auth/withdraw-reasons';

test('API의 탈퇴 사유 목록과 앱 data/account-settings.ts의 WITHDRAWAL_REASONS가 같다', () => {
  expect([...WITHDRAWAL_REASON_KEYS].sort()).toEqual(WITHDRAWAL_REASONS.map((r) => r.key).sort());
});
