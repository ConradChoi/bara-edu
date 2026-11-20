import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';

const config = loadConfig(process.env);
const pool = createPool(config.databaseUrl);
const app = buildApp({ config, pool, mailer: undefined });

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  console.error(err);
  process.exit(1);
});
