import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Tx } from '../db/context.js';

// 2단계 인증 키 링(기획서 2.6). 마스터 키(버전별 32바이트)에서 HKDF-SHA256으로 용도·버전별 하위 키를 나눈다.
// info: bara-mfa/{용도}/v{n}. 한 키를 두 용도로 쓰지 않는다. 키 값·하위 키는 어디에도 로그로 남기지 않는다.

export type KeyPurpose = 'totp-secret' | 'recovery-code' | 'enroll-ticket' | 'key-check';
export type SecretUse = 'factor' | 'enrollment';

export type MfaKeyring = {
  readonly current: number;
  readonly versions: readonly number[];
  subkey(version: number, purpose: KeyPurpose): Buffer;
};

export class MfaKeyError extends Error {}

export const MFA_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_CHECK_PLAINTEXT = 'bara-mfa-key-check';

// "1=<base64>,2=<base64>" 또는 "1=/ssm/name,2=..." 형식. 버전은 1~32767 정수, 중복 금지.
export function parseVersionList(raw: string, name: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf('=');
    const v = part.slice(0, i);
    const value = part.slice(i + 1).trim();
    if (i <= 0 || !/^[1-9][0-9]{0,4}$/.test(v) || Number(v) > 32767 || !value || out.has(Number(v))) {
      throw new MfaKeyError(`${name} must look like "1=...,2=..." (unique positive versions)`);
    }
    out.set(Number(v), value);
  }
  if (out.size === 0) throw new MfaKeyError(`${name} is empty`);
  return out;
}

// base64(표준) 문자열을 정확히 32바이트로 풀지 못하면 거절한다(보안 점검 M-6). 오류 문구에 값을 넣지 않는다.
export function decodeMasterKey(b64: string, version: number): Buffer {
  const clean = b64.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new MfaKeyError(`MFA key v${version} is not base64`);
  const buf = Buffer.from(clean, 'base64');
  if (buf.length !== MFA_KEY_BYTES || buf.toString('base64') !== clean) throw new MfaKeyError(`MFA key v${version} must decode to exactly 32 bytes`);
  return buf;
}

export function makeKeyring(masters: Map<number, Buffer>, current: number): MfaKeyring {
  if (!masters.has(current)) throw new MfaKeyError(`BARA_MFA_KEY_CURRENT=${current} is not in the key list`);
  const cache = new Map<string, Buffer>();
  const versions = [...masters.keys()].sort((a, b) => a - b);
  return {
    current,
    versions,
    subkey(version, purpose) {
      const master = masters.get(version);
      if (!master) throw new MfaKeyError(`MFA key v${version} is not loaded`);
      const id = `${purpose}/v${version}`;
      let k = cache.get(id);
      if (!k) {
        k = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `bara-mfa/${purpose}/v${version}`, 32));
        cache.set(id, k);
      }
      return k;
    },
  };
}

// AAD = "bara-mfa|{용도}|{user_id}|v{버전}" (보안 점검 M-4). 다른 사람·다른 테이블로 옮겨 붙이면 풀리지 않는다.
const aad = (use: string, owner: string, version: number) => Buffer.from(`bara-mfa|${use}|${owner}|v${version}`);

export type Sealed = { ciphertext: Buffer; iv: Buffer; keyVersion: number };

function seal(key: Buffer, ad: Buffer, plaintext: Buffer): { ciphertext: Buffer; iv: Buffer } {
  const iv = randomBytes(IV_BYTES); // 암호화할 때마다 새 IV(재암호화 포함)
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(ad);
  const body = Buffer.concat([c.update(plaintext), c.final()]);
  return { ciphertext: Buffer.concat([body, c.getAuthTag()]), iv };
}

function open(key: Buffer, ad: Buffer, ciphertext: Buffer, iv: Buffer): Buffer {
  if (iv.length !== IV_BYTES || ciphertext.length < TAG_BYTES) throw new MfaKeyError('sealed value is malformed');
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(ad);
  d.setAuthTag(ciphertext.subarray(ciphertext.length - TAG_BYTES));
  try {
    return Buffer.concat([d.update(ciphertext.subarray(0, ciphertext.length - TAG_BYTES)), d.final()]);
  } catch {
    throw new MfaKeyError('sealed value did not authenticate');
  }
}

export function encryptSecret(ring: MfaKeyring, userId: string, use: SecretUse, secret: Buffer): Sealed {
  const v = ring.current;
  return { ...seal(ring.subkey(v, 'totp-secret'), aad(use, userId, v), secret), keyVersion: v };
}

export function decryptSecret(ring: MfaKeyring, userId: string, use: SecretUse, row: { ciphertext: Buffer; iv: Buffer; keyVersion: number }): Buffer {
  return open(ring.subkey(row.keyVersion, 'totp-secret'), aad(use, userId, row.keyVersion), row.ciphertext, row.iv);
}

// 복구 코드·등록 코드 HMAC. 입력은 정규화된 값(복구 코드: 대문자 10글자, 등록 코드: 숫자 8자리).
export function codeHmac(ring: MfaKeyring, version: number, purpose: 'recovery-code' | 'enroll-ticket', normalized: string): Buffer {
  return createHmac('sha256', ring.subkey(version, purpose)).update(normalized).digest();
}

export function hmacEquals(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

// 시작 시 키 검증(보안 점검 M-6): 읽은 버전마다 auth.mfa_key_check 행을 풀어 정해진 평문과 비교한다.
// 현재 버전의 행이 없으면 만든다. 현재가 아닌 버전의 행이 없으면 거절한다(한 번도 현재 키로 쓰인 적 없는 키는 검증할 수 없다).
export async function verifyKeyCheckIn(tx: Tx, ring: MfaKeyring): Promise<{ created: number[] }> {
  await tx.query('select pg_advisory_xact_lock(hashtext($1))', ['bara_edu.mfa_key_check']);
  const created: number[] = [];
  for (const v of ring.versions) {
    const r = await tx.query<{ ciphertext: Buffer; iv: Buffer }>('select ciphertext, iv from auth.mfa_key_check where key_version = $1', [v]);
    const ad = Buffer.from(`bara-mfa|key-check|v${v}`);
    if (r.rowCount === 0) {
      if (v !== ring.current) throw new MfaKeyError(`MFA key v${v} has no key check row (only the current key may create one)`);
      const s = seal(ring.subkey(v, 'key-check'), ad, Buffer.from(KEY_CHECK_PLAINTEXT));
      await tx.query('insert into auth.mfa_key_check (key_version, ciphertext, iv) values ($1, $2, $3)', [v, s.ciphertext, s.iv]);
      created.push(v);
      continue;
    }
    let plain: Buffer;
    try {
      plain = open(ring.subkey(v, 'key-check'), ad, r.rows[0].ciphertext, r.rows[0].iv);
    } catch {
      throw new MfaKeyError(`MFA key v${v} does not match the stored key check (wrong key?)`);
    }
    if (plain.toString() !== KEY_CHECK_PLAINTEXT) throw new MfaKeyError(`MFA key v${v} does not match the stored key check (wrong key?)`);
  }
  return { created };
}
