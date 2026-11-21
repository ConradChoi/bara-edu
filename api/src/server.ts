import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import type { Mailer } from './mail/mailer.js';
import { SesMailer } from './mail/ses.js';
import type { Storage } from './storage/storage.js';
import { S3Storage } from './storage/s3.js';

const config = loadConfig(process.env);
const pool = createPool(config.databaseUrl);
const mailer: Mailer = process.env.MAIL_FROM
  ? new SesMailer(new SESv2Client({ region: config.awsRegion }), process.env.MAIL_FROM)
  : {
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
