import { expect, test } from 'vitest';
import { maskName } from '@/lib/supabase/admin-queries';

test('이름 가림: 첫 글자 + **, 빈 값은 -, 코드 포인트 기준', () => {
  expect(maskName('홍길동')).toBe('홍**');
  expect(maskName('  Kim ')).toBe('K**');
  expect(maskName('𠮷野家')).toBe('𠮷**');
  expect(maskName('')).toBe('-');
  expect(maskName(null)).toBe('-');
});
