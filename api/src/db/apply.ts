import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db');

export async function applyDb(adminUrl: string, opts: { appPassword: string }): Promise<void> {
  const files = (await readdir(dbDir)).filter((f) => f.endsWith('.sql')).sort();
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const file of files) {
      await client.query(await readFile(path.join(dbDir, file), 'utf8'));
    }
    await client.query(`alter role bara_edu_app password ${client.escapeLiteral(opts.appPassword)}`);
  } finally {
    await client.end();
  }
}
