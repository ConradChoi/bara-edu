import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db');
const BOOTSTRAP_FILE = '00-roles.sql';

async function runFiles(adminUrl: string, pick: (files: string[]) => string[], afterwards?: (client: pg.Client) => Promise<void>): Promise<void> {
  const files = pick((await readdir(dbDir)).filter((f) => f.endsWith('.sql')).sort());
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const file of files) {
      await client.query(await readFile(path.join(dbDir, file), 'utf8'));
    }
    await afterwards?.(client);
  } finally {
    await client.end();
  }
}

// roles and the app role password; without appPassword an existing password is left alone
export function applyBootstrap(adminUrl: string, opts: { appPassword?: string } = {}): Promise<void> {
  return runFiles(
    adminUrl,
    (files) => files.filter((f) => f === BOOTSTRAP_FILE),
    async (client) => {
      if (opts.appPassword) await client.query(`alter role bara_edu_app password ${client.escapeLiteral(opts.appPassword)}`);
    },
  );
}

export function applyMigrations(adminUrl: string): Promise<void> {
  return runFiles(adminUrl, (files) => files.filter((f) => f !== BOOTSTRAP_FILE));
}

export async function applyDb(adminUrl: string, opts: { appPassword: string }): Promise<void> {
  await applyBootstrap(adminUrl, opts);
  await applyMigrations(adminUrl);
}
