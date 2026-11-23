import { readFileSync } from 'node:fs';
import type { Config } from './config.js';

export type HttpsOptions = { key: Buffer; cert: Buffer };

// Reads TLS_CERT_FILE / TLS_KEY_FILE once at startup. The error names the variable only, never the file contents.
export function readTls(config: Pick<Config, 'tls'>, read: (path: string) => Buffer = (p) => readFileSync(p)): HttpsOptions | undefined {
  if (!config.tls) return undefined;
  let cert: Buffer;
  let key: Buffer;
  try {
    cert = read(config.tls.certFile);
  } catch {
    throw new Error('TLS_CERT_FILE could not be read');
  }
  try {
    key = read(config.tls.keyFile);
  } catch {
    throw new Error('TLS_KEY_FILE could not be read');
  }
  return { key, cert };
}
