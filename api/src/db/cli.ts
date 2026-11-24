import { applyBootstrap, applyMigrations } from './apply.js';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const command = process.argv[2];
if (!adminUrl) {
  console.error('DATABASE_ADMIN_URL is required');
  process.exit(1);
}
if (command !== 'bootstrap' && command !== 'migrate') {
  console.error('usage: cli.js bootstrap|migrate');
  process.exit(1);
}

const run = command === 'bootstrap' ? applyBootstrap(adminUrl, { appPassword: process.env.BARA_APP_DB_PASSWORD || undefined }) : applyMigrations(adminUrl);
run.then(
  () => console.log(`db:${command} done`),
  (err: { code?: string }) => {
    console.error(`db:${command} failed`, err?.code ?? '');
    process.exit(1);
  },
);
