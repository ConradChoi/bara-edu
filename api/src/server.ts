import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import type { Mailer } from './mail/mailer.js';

const config = loadConfig(process.env);
const pool = createPool(config.databaseUrl);
// SES mailer lands in the next plan; fail loudly instead of dropping mail silently
const mailer: Mailer = {
  async send() {
    throw new Error('mailer not configured');
  },
};
const app = buildApp({ config, pool, mailer, logger: { level: config.logLevel } });

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  console.error(err);
  process.exit(1);
});
