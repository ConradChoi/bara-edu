import { expect, test } from 'vitest';
import { leadNoteHasPii } from '@/lib/admin-profile-edit';

test('리드 메모: 서버와 같은 개인정보 규칙, 줄바꿈은 허용하고 길이 제한은 없다', () => {
  for (const bad of ['010-1234-5678', '홍@a.com', '+82 10', '900101-1234567', '010\n1234\n5678']) expect(leadNoteHasPii(bad), bad).toBe(true);
  for (const ok of ['통화 완료', '2026-11-26 14:12 통화', '1줄\n2줄\t3', '가'.repeat(2000), '12345678']) expect(leadNoteHasPii(ok), ok).toBe(false);
});
