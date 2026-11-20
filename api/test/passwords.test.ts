import { expect, test } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';

const SUPABASE_STYLE = '$2a$10$pQN/aei0gNcP/l9sJiZFFuvyVgUf51LJa2oFKUOTork19jmTTLtEC';

test('Supabase 형식($2a$10$) 해시를 검증한다', async () => {
  expect(await verifyPassword('correct-horse', SUPABASE_STYLE)).toBe('ok');
  expect(await verifyPassword('wrong', SUPABASE_STYLE)).toBe('mismatch');
});

test.each([null, '', 'plaintext', '$argon2id$v=19$m=65536'])('bcrypt가 아니면 unsupported: %s', async (h) => {
  expect(await verifyPassword('x', h)).toBe('unsupported');
});

test('hashPassword는 cost 10 bcrypt 해시를 만들고 검증된다', async () => {
  const h = await hashPassword('s3cret-pass');
  expect(h).toMatch(/^\$2[aby]\$10\$/);
  expect(await verifyPassword('s3cret-pass', h)).toBe('ok');
  expect(await verifyPassword('other-pass', h)).toBe('mismatch');
});
