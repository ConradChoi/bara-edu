import { buildApp } from './app.js';
import { loadConfig, PLAINTEXT_WARNING } from './config.js';
import { createPool } from './db/pool.js';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import type { Mailer } from './mail/mailer.js';
import { SesMailer } from './mail/ses.js';
import type { Storage } from './storage/storage.js';
import { S3Storage } from './storage/s3.js';
import { startScheduler } from './jobs/scheduler.js';
import { devFakes } from './dev-fakes.js';
import { resolveMfaKeyring, resolveServiceKey } from './secrets.js';
import { initMfa } from './auth/mfa-mode.js';
import { readTls } from './tls.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env, { serviceKey: await resolveServiceKey(process.env), mfaKeyring: await resolveMfaKeyring(process.env) });
  const https = readTls(config);
  const pool = createPool(config.databaseUrl);
  const fakes = devFakes(process.env, config.siteOrigins);
  const mailer: Mailer = fakes
    ? fakes.mailer
    : process.env.MAIL_FROM
      ? new SesMailer(new SESv2Client({ region: config.awsRegion }), process.env.MAIL_FROM, undefined, config.adminContactPhone)
      : {
          async send() {
            throw new Error('mailer not configured');
          },
        };
  const storage: Storage = fakes
    ? fakes.storage
    : config.s3Bucket
      ? new S3Storage(config.s3Bucket, config.awsRegion)
      : {
          async put() {
            throw new Error('storage not configured');
          },
          async remove() {
            throw new Error('storage not configured');
          },
          async signedUrl() {
            throw new Error('storage not configured');
          },
        };
  const app = buildApp({ config, pool, mailer, storage, logger: { level: config.logLevel }, https });
  if (config.plaintextAllowed) app.log.warn(PLAINTEXT_WARNING);
  // 키 검증 실패·DB 오류면 시작하지 않는다(기획서 2.6·2.14). 모드가 바뀐 첫 시작이면 비밀번호만의 관리자 세션을 지운다.
  await initMfa(pool, config.mfa, app.log);

  let scheduler: { stop(): void } | undefined;
  app.addHook('onClose', async () => scheduler?.stop());

  await app.listen({ port: config.port, host: config.host });
  scheduler = startScheduler(pool, { log: app.log, storage });
}

main().catch((err) => {
  // config/secret errors are fixed messages; only the message is printed (no values, no SDK error bodies)
  console.error(`startup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exit(1);
});
