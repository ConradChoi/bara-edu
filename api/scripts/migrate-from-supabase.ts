// 운영 Supabase → 새 DB 1회 이관. 출력은 건수·테이블 이름만(접속 주소·이메일·해시·키는 출력하지 않는다).
// 실행: node dist/scripts/migrate-from-supabase.js --source <원본 URL 환경변수 이름> --target <대상 URL 환경변수 이름> [--photos]
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { parse as parsePgUrl } from 'pg-connection-string';
import { S3Storage } from '../src/storage/s3.js';

export interface PhotoDownloader {
  // null when the object does not exist in the source bucket
  download(path: string): Promise<{ body: Buffer; contentType: string } | null>;
}
export interface PhotoUploader {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
}
export type MigrateOptions = {
  sourceUrl: string;
  targetUrl: string;
  photos?: { downloader: PhotoDownloader; uploader: PhotoUploader };
  log?: (line: string) => void;
  batchSize?: number;
};

export class MigrationFailure extends Error {}

const AUTH_USER_COLUMNS = ['id', 'email', 'encrypted_password', 'email_confirmed_at', 'created_at', 'updated_at', 'raw_user_meta_data'];
const CHECKSUM_TABLES = ['profiles', 'enrollments', 'certificates', 'course_exam_submissions', 'diagnosis_results'];
// rows the migrations seed into a fresh target; replaced by the source rows
const SEEDED_TABLES = new Set(['diagnosis_course_links']);
// same rule as the API storage routes (api/src/storage/routes.ts) plus no dot-only segment
const API_PHOTO_PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,100}$/;

export function isSafePhotoKey(key: string): boolean {
  return API_PHOTO_PATH.test(key) && key.split('/').every((seg) => seg !== '' && !/^\.+$/.test(seg));
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function dbIdentity(url: string): string {
  const c = parsePgUrl(url) as { host?: string | null; port?: string | null; database?: string | null; user?: string };
  const host = (c.host ?? 'localhost').toLowerCase();
  return [LOCAL.has(host) ? 'localhost' : host, c.port || '5432', c.database || c.user || ''].join('|');
}

export function isSameDatabase(a: string, b: string): boolean {
  return dbIdentity(a) === dbIdentity(b);
}

type TableInfo = { name: string; columns: string[]; pk: string[]; identity: boolean };
type ForeignKey = { name: string; child: string; childCols: string[]; parentSchema: string; parent: string; parentCols: string[] };

async function readTables(db: pg.ClientBase): Promise<Map<string, TableInfo>> {
  const r = await db.query<{ name: string; columns: string[]; pk: string[] | null; identity: boolean }>(
    `select c.relname as name,
            array_agg(a.attname::text order by a.attnum) filter (where a.attgenerated = '') as columns,
            (select array_agg(pa.attname::text order by k.ord)
               from pg_constraint pc, unnest(pc.conkey) with ordinality k(attnum, ord)
               join pg_attribute pa on pa.attrelid = c.oid and pa.attnum = k.attnum
              where pc.conrelid = c.oid and pc.contype = 'p') as pk,
            bool_or(a.attidentity = 'a') as identity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
      group by c.oid, c.relname`,
  );
  return new Map(r.rows.map((t) => [t.name, { name: t.name, columns: t.columns ?? [], pk: t.pk ?? [], identity: t.identity }]));
}

async function readForeignKeys(db: pg.ClientBase): Promise<ForeignKey[]> {
  const r = await db.query<ForeignKey>(
    `select con.conname::text as name, cc.relname::text as child, pn.nspname::text as "parentSchema", pc.relname::text as parent,
            (select array_agg(a.attname::text order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as "childCols",
            (select array_agg(a.attname::text order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as "parentCols"
       from pg_constraint con
       join pg_class cc on cc.oid = con.conrelid
       join pg_namespace cn on cn.oid = cc.relnamespace
       join pg_class pc on pc.oid = con.confrelid
       join pg_namespace pn on pn.oid = pc.relnamespace
      where con.contype = 'f' and cn.nspname = 'public'
      order by cc.relname, con.conname`,
  );
  return r.rows;
}

function fkOrder(tables: string[], fks: ForeignKey[]): string[] {
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const fk of fks) {
    if (fk.parentSchema === 'public' && fk.parent !== fk.child && deps.has(fk.parent)) deps.get(fk.child)?.add(fk.parent);
  }
  const order: string[] = [];
  const pending = [...tables].sort();
  while (pending.length) {
    const i = pending.findIndex((t) => [...deps.get(t)!].every((d) => order.includes(d)));
    // a cycle cannot be ordered; FK triggers are off and the orphan check runs afterwards
    order.push(pending.splice(i === -1 ? 0 : i, 1)[0]!);
  }
  return order;
}

async function count(db: pg.ClientBase, schema: string, table: string): Promise<number> {
  const r = await db.query<{ n: string }>(`select count(*) as n from ${q(schema)}.${q(table)}`);
  return Number(r.rows[0]!.n);
}

async function idChecksum(db: pg.ClientBase, schema: string, table: string): Promise<string | null> {
  const r = await db.query<{ h: string | null }>(`select md5(string_agg(id::text, ',' order by id)) as h from ${q(schema)}.${q(table)}`);
  return r.rows[0]!.h;
}

async function copyTable(
  src: pg.ClientBase,
  dst: pg.ClientBase,
  schema: string,
  table: string,
  columns: string[],
  selectExprs: string[],
  orderBy: string[],
  identity: boolean,
  batchSize: number,
): Promise<number> {
  const cols = columns.map(q).join(', ');
  const exprs = selectExprs.join(', ');
  const order = orderBy.map(q).join(', ');
  let copied = 0;
  for (let offset = 0; ; offset += batchSize) {
    // json as text: pg would otherwise parse it into JS numbers and lose numeric precision
    const r = await src.query<{ rows: string | null; n: number }>(
      `select json_agg(t)::text as rows, count(*)::int as n
         from (select ${exprs} from ${q(schema)}.${q(table)} order by ${order} limit ${batchSize} offset ${offset}) t`,
    );
    const { rows, n } = r.rows[0]!;
    if (!rows || n === 0) break;
    await dst.query(
      `insert into ${q(schema)}.${q(table)} (${cols}) ${identity ? 'overriding system value ' : ''}
       select ${cols} from json_populate_recordset(null::${q(schema)}.${q(table)}, $1::json)`,
      [rows],
    );
    copied += n;
    if (n < batchSize) break;
  }
  return copied;
}

async function orphanCount(dst: pg.ClientBase, fk: ForeignKey): Promise<number> {
  const notNull = fk.childCols.map((c) => `c.${q(c)} is not null`).join(' and ');
  const match = fk.childCols.map((c, i) => `p.${q(fk.parentCols[i]!)} = c.${q(c)}`).join(' and ');
  const r = await dst.query<{ n: string }>(
    `select count(*) as n from public.${q(fk.child)} c
      where ${notNull} and not exists (select 1 from ${q(fk.parentSchema)}.${q(fk.parent)} p where ${match})`,
  );
  return Number(r.rows[0]!.n);
}

export async function migrate(opts: MigrateOptions): Promise<number> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const batchSize = opts.batchSize ?? 1000;
  if (isSameDatabase(opts.sourceUrl, opts.targetUrl)) {
    log('refused: source and target are the same database');
    return 1;
  }
  const src = new pg.Client({ connectionString: opts.sourceUrl });
  const dst = new pg.Client({ connectionString: opts.targetUrl });
  // an idle connection drop is emitted as 'error'; without a listener Node crashes. The next query then fails normally.
  const lost: string[] = [];
  src.on('error', () => lost.push('source'));
  dst.on('error', () => lost.push('target'));
  let step = 'connect';
  let target: 'none' | 'open' | 'committing' | 'committed' = 'none';
  try {
    await src.connect();
    await dst.connect();
    step = 'begin';
    await src.query('begin isolation level repeatable read read only');
    // a policy that would hide source rows becomes an error instead of an undercount
    await src.query('set local row_security = off');
    await dst.query('begin');
    target = 'open';
    // must be set before the role switch: bara_edu_service cannot set it, and it stays in effect after set role
    await dst.query('set local session_replication_role = replica');
    // the owner role sees every row (RLS does not apply to owners), so the empty check below cannot be fooled
    await dst.query('set local role bara_edu_service');
    await dst.query('set local row_security = off');
    await dst.query('set local statement_timeout = 0');

    step = 'catalog';
    const migrated = await dst.query<{ ok: boolean }>(`select to_regclass('auth.users') is not null and to_regclass('public.profiles') is not null as ok`);
    if (!migrated.rows[0]!.ok) throw new MigrationFailure('target is not migrated (run db:bootstrap and db:migrate first)');
    const targetTables = await readTables(dst);
    const sourceTables = await readTables(src);
    const fks = await readForeignKeys(dst);

    const extraTables = [...sourceTables.keys()].filter((t) => !targetTables.has(t)).sort();
    if (extraTables.length) throw new MigrationFailure(`source tables missing in target: ${extraTables.join(', ')}`);
    const extraColumns: string[] = [];
    const defaulted: string[] = [];
    for (const [name, t] of targetTables) {
      const s = sourceTables.get(name);
      if (!s) continue;
      for (const c of s.columns) if (!t.columns.includes(c)) extraColumns.push(`${name}.${c}`);
      for (const c of t.columns) if (!s.columns.includes(c)) defaulted.push(`${name}.${c}`);
    }
    if (extraColumns.length) throw new MigrationFailure(`source columns missing in target: ${extraColumns.join(', ')}`);
    if (defaulted.length) log(`target-only columns left at default: ${defaulted.join(', ')}`);
    const skipped = [...targetTables.keys()].filter((t) => !sourceTables.has(t)).sort();
    if (skipped.length) log(`target-only tables left empty: ${skipped.join(', ')}`);

    step = 'empty check';
    const nonEmpty: string[] = [];
    if ((await dst.query('select 1 from auth.users limit 1')).rowCount) nonEmpty.push('auth.users');
    for (const name of [...targetTables.keys()].sort()) {
      if (SEEDED_TABLES.has(name)) continue;
      if ((await dst.query(`select 1 from public.${q(name)} limit 1`)).rowCount) nonEmpty.push(name);
    }
    if (nonEmpty.length) throw new MigrationFailure(`refused: target is not empty (${nonEmpty.join(', ')})`);

    step = 'password hashes';
    const h = await src.query<{ a: number; b: number; other: number; reset: number; unconfirmed: number }>(
      `select count(*) filter (where encrypted_password like '$2a$%')::int as a,
              count(*) filter (where encrypted_password like '$2b$%')::int as b,
              count(*) filter (where encrypted_password is null or (encrypted_password not like '$2a$%' and encrypted_password not like '$2b$%'))::int as other,
              count(*) filter (where encrypted_password is null or encrypted_password !~ '^\\$2[aby]\\$')::int as reset,
              count(*) filter (where email_confirmed_at is null)::int as unconfirmed
         from auth.users`,
    );
    const hs = h.rows[0]!;
    log(`password hashes: $2a$=${hs.a} $2b$=${hs.b} other=${hs.other} (password_reset_required on login: ${hs.reset})`);
    log(`unconfirmed email: ${hs.unconfirmed}`);

    // for the operator to judge in rehearsal; these rows are copied like any other
    step = 'source user flags';
    const ucols = new Set(
      (await src.query<{ c: string }>(`select column_name::text as c from information_schema.columns where table_schema = 'auth' and table_name = 'users'`)).rows.map(
        (r) => r.c,
      ),
    );
    const flags: [string, string, string][] = [
      ['deleted_at', 'deleted_at', 'deleted_at is not null'],
      ['banned_until', 'banned_until', 'banned_until is not null'],
      ['null_email', 'email', 'email is null'],
      ['is_anonymous', 'is_anonymous', 'is_anonymous is true'],
    ];
    const flagOut: string[] = [];
    for (const [label, col, cond] of flags) {
      const n = ucols.has(col) ? (await src.query<{ n: number }>(`select count(*)::int as n from auth.users where ${cond}`)).rows[0]!.n : 'n/a';
      flagOut.push(`${label}=${n}`);
    }
    log(`source auth.users: ${flagOut.join(' ')}`);

    step = 'copy auth.users';
    const counts: { label: string; schema: string; table: string }[] = [{ label: 'auth.users', schema: 'auth', table: 'users' }];
    const userExprs = [
      'id',
      'email',
      'encrypted_password',
      'email_confirmed_at',
      'coalesce(created_at, now()) as created_at',
      'coalesce(updated_at, created_at, now()) as updated_at',
      `coalesce(raw_user_meta_data, '{}'::jsonb) as raw_user_meta_data`,
    ];
    await copyTable(src, dst, 'auth', 'users', AUTH_USER_COLUMNS, userExprs, ['id'], false, batchSize);

    for (const name of fkOrder([...targetTables.keys()].filter((t) => sourceTables.has(t)), fks)) {
      step = `copy ${name}`;
      const t = targetTables.get(name)!;
      const s = sourceTables.get(name)!;
      if (SEEDED_TABLES.has(name)) await dst.query(`delete from public.${q(name)}`);
      const cols = t.columns.filter((c) => s.columns.includes(c));
      await copyTable(src, dst, 'public', name, cols, cols.map(q), t.pk.length ? t.pk : cols, t.identity, batchSize);
      counts.push({ label: name, schema: 'public', table: name });
    }

    step = 'foreign keys';
    let orphans = 0;
    for (const fk of fks) {
      const n = await orphanCount(dst, fk);
      if (n) log(`orphan rows: ${fk.child} (${fk.name}) ${n}`);
      orphans += n;
    }
    if (orphans) throw new MigrationFailure(`foreign key check failed: ${orphans} orphan rows`);

    step = 'sequences';
    const seqs = await dst.query<{ seq: string; tbl: string; col: string }>(
      `select s.relname::text as seq, t.relname::text as tbl, a.attname::text as col
         from pg_class s
         join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
         join pg_class t on t.oid = d.refobjid
         join pg_namespace n on n.oid = t.relnamespace
         join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
        where s.relkind = 'S' and n.nspname = 'public'`,
    );
    for (const s of seqs.rows) {
      await dst.query(
        `select setval('public.${q(s.seq)}'::regclass, coalesce((select max(${q(s.col)}) from public.${q(s.tbl)}), 0) + 1, false)`,
      );
    }
    log(`sequences reset: ${seqs.rowCount}`);

    step = 'verify';
    let mismatches = 0;
    for (const c of counts) {
      const a = await count(src, c.schema, c.table);
      const b = await count(dst, c.schema, c.table);
      log(`${c.label}: source=${a} target=${b}${a === b ? '' : ' MISMATCH'}`);
      if (a !== b) mismatches++;
    }
    for (const [schema, table] of [['auth', 'users'], ...CHECKSUM_TABLES.map((t) => ['public', t])] as [string, string][]) {
      if (schema === 'public' && !(targetTables.has(table) && sourceTables.has(table))) throw new MigrationFailure(`checksum table missing: ${table}`);
      const same = (await idChecksum(src, schema, table)) === (await idChecksum(dst, schema, table));
      log(`checksum ${schema === 'auth' ? 'auth.users' : table}: ${same ? 'match' : 'MISMATCH'}`);
      if (!same) mismatches++;
    }
    if (mismatches) throw new MigrationFailure(`verification failed: ${mismatches} mismatches`);

    step = 'photo paths';
    const p = await src.query<{ id: string; photo_path: string }>(
      `select id::text, photo_path from public.profiles where photo_path is not null and photo_path <> '' order by id`,
    );
    const nonStandard = p.rows.filter((r) => r.photo_path !== `${r.id}/photo`).length;
    const rejected = p.rows.filter((r) => !isSafePhotoKey(r.photo_path)).length;
    log(`photo paths: ${p.rowCount}, not <uid>/photo: ${nonStandard}, rejected (not an API photo key): ${rejected}`);

    if (opts.photos) {
      step = 'photos';
      // keys go into a URL that carries the service key, so nothing is fetched unless every key is safe
      if (rejected) throw new MigrationFailure(`photos refused: ${rejected} photo paths are not valid keys`);
      let uploaded = 0;
      let missing = 0;
      for (const r of p.rows) {
        const obj = await opts.photos.downloader.download(r.photo_path);
        if (!obj) {
          missing++;
          continue;
        }
        await opts.photos.uploader.put(r.photo_path, obj.body, obj.contentType);
        uploaded++;
      }
      log(`photos: source=${p.rowCount} uploaded=${uploaded} missing=${missing}`);
      if (uploaded !== p.rowCount) throw new MigrationFailure('photo count mismatch');
    }

    // the source is ended before the target commit so that nothing fallible runs after the commit
    step = 'end source';
    await src.query('rollback');
    step = 'commit';
    if (lost.length) throw new MigrationFailure('connection lost before commit');
    target = 'committing';
    await dst.query('commit');
    target = 'committed';
    log('migration done');
    return 0;
  } catch (err) {
    if (err instanceof MigrationFailure) {
      log(err.message);
    } else {
      // pg messages can carry row values or hosts, so only the code and schema names are printed
      const e = err as { code?: string; table?: string; constraint?: string; column?: string; name?: string };
      const where = [e.table, e.column, e.constraint].filter(Boolean).join(' ');
      log(`failed at ${step}: ${e.code ?? e.name ?? 'error'}${where ? ` (${where})` : ''}`);
    }
    if (lost.length) log(`connection lost: ${[...new Set(lost)].join(', ')}`);
    if (target === 'open') {
      const rolledBack = await dst.query('rollback').then(
        () => true,
        () => false,
      );
      log(rolledBack ? 'target rolled back' : 'target not committed (connection lost; the server discards the open transaction)');
    } else if (target === 'committing') {
      // a server-side commit error (SQLSTATE present) means the transaction was rolled back; a dropped connection leaves it unknown
      log((err as { code?: string }).code ? 'target rolled back (commit rejected)' : 'target commit status unknown: check whether the target is empty before re-running');
    } else if (target === 'committed') {
      log('target committed');
    }
    return 1;
  } finally {
    await src.end().catch(() => {});
    await dst.end().catch(() => {});
  }
}

export class SupabaseStorageDownloader implements PhotoDownloader {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
    private readonly bucket = 'member-photos',
  ) {}

  async download(path: string): Promise<{ body: Buffer; contentType: string } | null> {
    if (!isSafePhotoKey(path)) throw new MigrationFailure('photo path rejected');
    const [owner, file] = path.split('/') as [string, string];
    const url = new URL(`/storage/v1/object/${this.bucket}/${encodeURIComponent(owner)}/${encodeURIComponent(file)}`, this.baseUrl);
    if (url.pathname !== `/storage/v1/object/${this.bucket}/${owner}/${file}`) throw new MigrationFailure('photo path rejected');
    const headers: Record<string, string> = { apikey: this.serviceKey };
    // legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys only in apikey
    if (this.serviceKey.startsWith('eyJ')) headers.authorization = `Bearer ${this.serviceKey}`;
    const res = await fetch(url, { headers, redirect: 'error' });
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok) throw new MigrationFailure(`photo download failed: HTTP ${res.status}`);
    return { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
  }
}

function envValue(name: string | undefined, what: string): string {
  if (!name) throw new MigrationFailure(`--${what} <env var name> is required`);
  const v = process.env[name];
  if (!v) throw new MigrationFailure(`env var ${name} (${what}) is empty`);
  return v;
}

export async function main(argv: string[]): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: { source: { type: 'string' }, target: { type: 'string' }, photos: { type: 'boolean', default: false } },
      strict: true,
    });
    const sourceUrl = envValue(values.source, 'source');
    const targetUrl = envValue(values.target, 'target');
    let photos: MigrateOptions['photos'];
    if (values.photos) {
      const supabaseUrl = envValue('SUPABASE_URL', 'photos');
      if (!/^https:\/\//.test(supabaseUrl)) throw new MigrationFailure('SUPABASE_URL must start with https://');
      photos = {
        downloader: new SupabaseStorageDownloader(supabaseUrl, envValue('SUPABASE_SERVICE_ROLE_KEY', 'photos')),
        uploader: new S3Storage(envValue('S3_BUCKET', 'photos'), process.env.AWS_REGION || 'ap-northeast-2'),
      };
    }
    return await migrate({ sourceUrl, targetUrl, photos });
  } catch (err) {
    console.error(err instanceof MigrationFailure ? err.message : 'usage: migrate-from-supabase --source <ENV_NAME> --target <ENV_NAME> [--photos]');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
