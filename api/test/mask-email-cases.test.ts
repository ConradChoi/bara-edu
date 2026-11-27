import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskEmail } from '../src/ops/admin-diagnosis.js';

// 앱 lib/mask-email.ts와 같은 결과인지 공용 표로 본다(앱 test/lib/mask-email.test.ts와 같은 표).
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures', 'mask-email-cases.json');
const { cases } = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: [string | null, string][] };

test('공용 표가 비어 있지 않다', () => expect(cases.length).toBeGreaterThan(10));
test.each(cases)('maskEmail(%j) → %j', (input, out) => {
  expect(maskEmail(input)).toBe(out);
});
