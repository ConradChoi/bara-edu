import bcrypt from 'bcryptjs';

const BCRYPT_PREFIX = /^\$2[aby]\$/;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<'ok' | 'mismatch' | 'unsupported'> {
  if (!hash || !BCRYPT_PREFIX.test(hash)) return 'unsupported';
  return (await bcrypt.compare(plain, hash)) ? 'ok' : 'mismatch';
}
