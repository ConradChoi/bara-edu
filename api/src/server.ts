import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import type { Mailer } from './mail/mailer.js';
import type { Storage } from './storage/storage.js';
import { S3Storage } from './storage/s3.js';

const config = loadConfig(process.env);
const pool = createPool(config.databaseUrl);
// SES mailer lands in the next plan; fail loudly instead of dropping mail silently
const mailer: Mailer = {
  async send() {
    throw new Error('mailer not configured');
  },
};
const storage: Storage = config.s3Bucket
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
const app = buildApp({ config, pool, mailer, storage, logger: { level: config.logLevel } });

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  console.error(err);
  process.exit(1);
});
