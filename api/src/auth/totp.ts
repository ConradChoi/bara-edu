import { createHmac, timingSafeEqual } from 'node:crypto';

// RFC 6238 TOTP(HMAC-SHA1, 6자리, 30초)와 RFC 4648 base32. 외부 의존성 없이 node:crypto로 구현한다(기획서 2.12 후보 3).
// 재사용 방지(last_used_step)는 이 모듈 밖(mfa.ts)에서 한다. 여기서는 맞은 칸 번호만 돌려준다.

export const PERIOD_SECONDS = 30;
export const DIGITS = 6;
export const SECRET_BYTES = 20;
export const ISSUER = '바라 평생교육원';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function stepAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / PERIOD_SECONDS);
}

// RFC 4226 HOTP. counter는 64비트 big-endian.
export function hotp(secret: Buffer, counter: number, digits = DIGITS, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpAt(secret: Buffer, nowMs: number): string {
  return hotp(secret, stepAt(nowMs));
}

// 현재 칸 t의 t-1, t, t+1 세 칸을 모두 계산해 상수 시간으로 비교한다(맞는 칸을 찾아도 멈추지 않는다, 보안 점검 M-9).
// 맞는 칸이 여럿이면 가장 큰 칸을 돌려준다. 없으면 null. code는 이미 ^[0-9]{6}$로 검사된 값이어야 한다.
export function matchStep(secret: Buffer, code: string, nowMs: number): number | null {
  const t = stepAt(nowMs);
  const given = Buffer.from(code.padEnd(DIGITS, '\0').slice(0, DIGITS));
  let found: number | null = null;
  for (const s of [t - 1, t, t + 1]) {
    const ok = timingSafeEqual(Buffer.from(hotp(secret, s)), given);
    if (ok && (found === null || s > found)) found = s;
  }
  return found;
}

// 기획서 4.4.2의 otpauthUri 형식 그대로.
export function otpauthUri(email: string, secretBase32: string): string {
  const label = encodeURIComponent(`${ISSUER}:${email}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(ISSUER)}&digits=${DIGITS}&period=${PERIOD_SECONDS}&algorithm=SHA1`;
}

// 6자리 입력: 공백·하이픈을 지운 뒤 숫자 6개(4.0). 아니면 null.
export function normalizeTotpInput(raw: string): string | null {
  const v = raw.replace(/[\s-]/g, '');
  return /^[0-9]{6}$/.test(v) ? v : null;
}
