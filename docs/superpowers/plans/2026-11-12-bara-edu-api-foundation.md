# bara-edu API 기반(1차: DB 포팅 + API 뼈대 + 인증) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supabase 없이 동작하는 bara-edu 전용 API의 기반(스키마 포팅, RLS 실행기, 자체 인증, 오퍼레이션 등록 구조)을 로컬 PostgreSQL 18에서 테스트로 증명한다.

**Architecture:** `bara_edu/api/` 에 독립 Node 프로젝트(Fastify)를 둔다. DB는 기존 `supabase/schema.sql`을 거의 그대로 쓰되, Supabase가 제공하던 `auth` 스키마(`auth.users`, `auth.uid()`, `auth.role()`)를 같은 이름의 자체 SQL로 대체해 RLS 정책 77개와 DB 함수를 유지한다. API는 요청마다 트랜잭션 안에서 `SET LOCAL ROLE` + 회원 id를 설정해 RLS가 그대로 걸리게 한다.

**Tech Stack:** Node 22, TypeScript, Fastify 5, `pg`, `zod`, `bcryptjs`, Vitest, Docker(`postgres:18`) — 테스트 전용.

**Spec:** `docs/superpowers/specs/2026-11-12-bara-edu-supabase-exit-design.md`

**이 계획의 범위(전체 3개 중 1차)**
- 1차(이 문서): 로컬에서만 동작. **AWS·운영 앱(`app/`, `lib/`)·Amplify를 건드리지 않는다.**
- 2차(별도 계획): 도메인 오퍼레이션 전체 + Next 앱 69개 파일 교체 + S3·SES·일일 정리 작업.
- 3차(별도 계획): 서버 설치(WAS·nginx·Jenkins·IAM, 각각 대표 확인), 운영 스키마 대조, 이관 스크립트, 리허설, 전환, 개인정보처리방침 갱신.

## Global Constraints

- Supabase 소프트웨어·SDK를 `api/`에 넣지 않는다(`@supabase/*` 의존성 금지).
- PostgreSQL 대상 버전은 **18**(테스트 이미지 `postgres:18`).
- DB 역할 이름은 접두어 고정: `bara_edu_app`(로그인, NOINHERIT), `bara_edu_anon`, `bara_edu_authenticated`, `bara_edu_service`(객체 소유자, 로그인 불가). `anon`/`authenticated`/`service_role` 이름은 만들지 않는다.
- `bara_edu_app`은 어떤 테이블의 소유자도 아니다(소유자는 RLS를 우회한다).
- 공용 DB 보호: `bara_edu_app`에 `CONNECTION LIMIT 20`, `statement_timeout = '15s'`.
- pg_cron·`storage` 스키마·확장 추가 없음(공용 파라미터 그룹을 바꾸지 않는다).
- 모든 API 경로(`/healthz` 제외)는 헤더 `x-bara-service-key`가 맞아야 한다. 브라우저가 직접 부르는 경로는 없다.
- 비밀번호 해시는 bcrypt(cost 10). Supabase에서 옮겨온 `$2a$`/`$2b$` 해시를 그대로 검증할 수 있어야 한다.
- 기존 앱 문구·검증 규칙 유지: 비밀번호 최소 8자, 이름 최소 2자.
- 커밋은 `api/` 와 `docs/` 아래 파일만. `infra/supabase-aws/` 의 미커밋 변경은 건드리지 않는다.
- 운영 Supabase·AWS에 접속하는 명령을 실행하지 않는다.

## Review Focus

1. **이메일 대소문자·공백**: `User@Bara-Edu.kr `로 가입하고 `user@bara-edu.kr`로 로그인 → 같은 계정으로 로그인돼야 한다(Supabase는 소문자로 정규화). → Task 7·8 테스트.
2. **풀 연결 재사용 시 권한 누수**: 회원 A 요청이 예외로 끝난 직후 같은 연결로 익명 요청이 오면 A의 권한·id가 남아 있으면 안 된다. → Task 4 테스트.
3. **만료·재사용 토큰**: 이미 쓴 인증/재설정 토큰, 만료된 토큰, 다른 용도의 토큰(인증 토큰으로 비밀번호 재설정) → 모두 거절. → Task 7·8 테스트.
4. **탈퇴·삭제 회원의 살아있는 세션**: 세션 발급 후 `profiles.status='withdrawn'`이 되거나 `auth.users` 행이 지워진 경우 → `/v1/auth/session`이 탈퇴 상태를 알려주거나 401. → Task 6 테스트.
5. **bcrypt가 아닌 해시·빈 해시**: 이관된 계정 중 해시가 비었거나 bcrypt가 아닌 경우 → 예외로 죽지 않고 `password_reset_required`로 응답. → Task 5·8 테스트.

---

## File Structure

```
api/
  package.json, tsconfig.json, vitest.config.ts, .env.example, .gitignore
  docker-compose.test.yml         postgres:18, 포트 54329
  db/
    00-roles.sql                  역할 4개 (멱등)
    01-auth.sql                   auth 스키마: users, sessions, email_tokens, rate_events, uid(), role()
    02-schema.sql                 supabase/schema.sql 포팅본 (storage·pg_cron 제거)
    03-grants.sql                 명시적 grant/revoke
  src/
    config.ts                     환경변수 로드·검증
    db/pool.ts                    pg Pool
    db/context.ts                 withUser / withAnon / withService
    db/apply.ts                   db/*.sql 순서대로 적용
    auth/passwords.ts             해시·검증
    auth/sessions.ts              세션 발급·조회·폐기
    auth/tokens.ts                이메일 인증·재설정 토큰
    auth/rate-limit.ts            DB 기반 요청 수 제한
    auth/service.ts               가입·로그인 등 유스케이스
    auth/routes.ts                /v1/auth/*, /v1/admin/users/*
    mail/mailer.ts                Mailer 인터페이스 + MemoryMailer
    ops/registry.ts               오퍼레이션 등록·실행
    ops/profiles.ts               예시 오퍼레이션 2개
    ops/routes.ts                 POST /v1/op/:name
    http/guard.ts                 서비스 키·세션 해석
    app.ts                        buildApp()
    server.ts                     listen
  test/
    helpers/db.ts                 테스트 DB 초기화·시드
    *.test.ts
```

---

### Task 1: 프로젝트 골격과 테스트용 PostgreSQL 18

**Files:**
- Create: `api/package.json`, `api/tsconfig.json`, `api/vitest.config.ts`, `api/.gitignore`, `api/.env.example`, `api/docker-compose.test.yml`
- Create: `api/src/config.ts`, `api/src/db/pool.ts`, `api/src/app.ts`, `api/src/server.ts`
- Test: `api/test/health.test.ts`, `api/test/config.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(env: NodeJS.ProcessEnv): Config` — `Config = { databaseUrl: string; serviceKey: string; port: number; sessionTtlDays: number; siteOrigins: string[] }`. `BARA_SERVICE_KEY`가 32자 미만이거나 `DATABASE_URL`이 없으면 throw. 기본값 `PORT=3100`, `SESSION_TTL_DAYS=30`, `SITE_ORIGINS=https://bara-edu.kr`(쉼표 구분).
  - `createPool(databaseUrl: string): pg.Pool` — `max: 10`.
  - `buildApp(deps: { config: Config; pool: pg.Pool; mailer: Mailer }): FastifyInstance` (Mailer 타입은 Task 7에서 정의 — 이 태스크에서는 `mailer: unknown`로 두고 Task 7이 좁힌다).
- npm scripts: `db:up`(`docker compose -f docker-compose.test.yml up -d --wait`), `db:down`, `test`(`vitest run`), `build`(`tsc`), `start`(`node dist/server.js`).
- 테스트 DB 접속: `postgresql://postgres:postgres@127.0.0.1:54329/postgres`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// api/test/config.test.ts
import { expect, test } from 'vitest';
import { loadConfig } from '../src/config';

test('서비스 키가 32자 미만이면 거절', () => {
  expect(() => loadConfig({ DATABASE_URL: 'postgresql://x', BARA_SERVICE_KEY: 'short' })).toThrow(/BARA_SERVICE_KEY/);
});
test('기본값', () => {
  const c = loadConfig({ DATABASE_URL: 'postgresql://x', BARA_SERVICE_KEY: 'k'.repeat(32) });
  expect(c).toMatchObject({ port: 3100, sessionTtlDays: 30, siteOrigins: ['https://bara-edu.kr'] });
});
```

```ts
// api/test/health.test.ts
test('GET /healthz 는 서비스 키 없이 200 {ok:true}', async () => {
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
});
```

- [ ] **Step 2: `cd api && npm install && npm test` → FAIL(모듈 없음) 확인**
- [ ] **Step 3: 위 Interfaces대로 구현.** `docker-compose.test.yml`은 `postgres:18`, `POSTGRES_PASSWORD=postgres`, 포트 `54329:5432`, healthcheck `pg_isready`.
- [ ] **Step 4: `npm run db:up && npm test` → PASS. `docker exec`로 `select version()`이 `PostgreSQL 18`로 시작하는지 확인.**
- [ ] **Step 5: Commit** — `git add api && git commit -m "feat(api): 프로젝트 골격과 PG18 테스트 환경"`

---

### Task 2: DB 역할과 auth 대체 스키마

**Files:**
- Create: `api/db/00-roles.sql`, `api/db/01-auth.sql`, `api/src/db/apply.ts`, `api/test/helpers/db.ts`
- Test: `api/test/db-auth.test.ts`

**Interfaces:**
- Produces (SQL):
  - 역할: Global Constraints의 4개. `bara_edu_app`은 나머지 3개의 멤버(`NOINHERIT`). 비밀번호는 `00-roles.sql`에 넣지 않는다 — `apply`가 `ALTER ROLE bara_edu_app PASSWORD`를 환경변수 `BARA_APP_DB_PASSWORD`로 설정.
  - `bara_edu_service`에 데이터베이스 `create`와 `public` 스키마 `usage, create`를 준다(PG15+는 `public`에 기본 create 권한이 없다). 적용 계정은 `bara_edu_service`의 멤버여야 `set role`이 된다(RDS의 마스터 계정도 superuser가 아니므로 `grant bara_edu_service to current_user`를 `00-roles.sql`에 포함).
  - `auth.users(id uuid pk default gen_random_uuid(), email text not null, encrypted_password text, email_confirmed_at timestamptz, raw_user_meta_data jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now())`, `email`에 `lower(email)` 유니크 인덱스.
  - `auth.sessions(token_hash text pk, user_id uuid not null references auth.users on delete cascade, created_at, expires_at timestamptz not null)`.
  - `auth.email_tokens(token_hash text pk, user_id uuid references auth.users on delete cascade, purpose text check (purpose in ('confirm','recovery')), expires_at timestamptz not null, used_at timestamptz)`.
  - `auth.rate_events(id bigint identity pk, bucket text not null, key text not null, created_at timestamptz default now())`, 인덱스 `(bucket, key, created_at)`.
  - `auth.uid() returns uuid` = `nullif(current_setting('request.user_id', true), '')::uuid` (stable).
  - `auth.role() returns text` = `auth.uid()`가 null이면 `'anon'`, 아니면 `'authenticated'`.
  - `auth` 스키마 객체 소유자는 `bara_edu_service`. `bara_edu_anon`/`bara_edu_authenticated`에는 `auth` 스키마 `usage`와 `auth.uid()`·`auth.role()` execute만 주고 **테이블 권한은 주지 않는다.**
- Produces (TS):
  - `applyDb(adminUrl: string, opts: { appPassword: string }): Promise<void>` — `db/*.sql`을 파일명 순서대로 실행. 두 번 실행해도 성공(멱등).
  - `test/helpers/db.ts`: `setupTestDb(): Promise<{ pool: pg.Pool; adminPool: pg.Pool; close(): Promise<void> }>` — 테스트 파일마다 새 데이터베이스(`bara_test_<random>`)를 만들고 `applyDb` 후 `bara_edu_app`으로 접속한 `pool`과 superuser `adminPool`을 돌려준다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// api/test/db-auth.test.ts
test('auth.uid()는 설정이 없으면 null, 설정하면 그 값', async () => {
  const c = await pool.connect();
  await c.query('begin');
  expect((await c.query('select auth.uid() u, auth.role() r')).rows[0]).toEqual({ u: null, r: 'anon' });
  await c.query("select set_config('request.user_id', $1, true)", [uid]);
  expect((await c.query('select auth.uid() u, auth.role() r')).rows[0]).toEqual({ u: uid, r: 'authenticated' });
  await c.query('rollback'); c.release();
});
test('bara_edu_authenticated 역할은 auth.users를 읽지 못한다', async () => {
  // begin; set local role bara_edu_authenticated; select * from auth.users → 42501
});
test('이메일은 대소문자 무시 유니크', async () => {
  // adminPool로 'A@x.kr' 넣고 'a@x.kr' 넣으면 23505
});
test('applyDb 두 번 실행해도 성공', async () => {});
test('bara_edu_app 은 NOINHERIT 이고 연결 상한 20', async () => {
  // pg_roles: rolinherit=false, rolconnlimit=20
});
```

- [ ] **Step 2: `npm test -- db-auth` → FAIL 확인**
- [ ] **Step 3: SQL과 `applyDb`, 헬퍼 구현**
- [ ] **Step 4: `npm test -- db-auth` → PASS**
- [ ] **Step 5: Commit** — `feat(api): DB 역할과 auth 대체 스키마`

---

### Task 3: 스키마 포팅과 명시적 권한

**Files:**
- Create: `api/db/02-schema.sql` (`supabase/schema.sql` 복사 후 수정), `api/db/03-grants.sql`
- Test: `api/test/db-schema.test.ts`

**Interfaces:**
- Consumes: Task 2의 `auth.users`, `auth.uid()`, `auth.role()`, 역할 이름.
- Produces: `public` 스키마 전체(테이블·함수·트리거·정책). 이후 태스크는 `profiles`, `bank_accounts`, `is_admin()`, `handle_new_user()` 트리거, `purge_unverified_signups()`에 의존.

**포팅 규칙(이 태스크의 결정 사항)**
- `supabase/schema.sql` **원본은 수정하지 않는다**(운영 Supabase가 아직 쓴다). 복사본만 고친다.
- 제거: `storage.buckets` insert와 `storage.objects` 정책 4개(원본 933~953줄 부근), `create extension ... pg_cron`과 `cron.schedule` 블록 3곳(원본 1679~1766, 2334~2340줄 부근). `purge_*` 함수 정의 4개는 **남긴다**(2차에서 API가 호출).
- 치환: `revoke ... from public, anon, authenticated` → `from public, bara_edu_anon, bara_edu_authenticated`; `from anon` → `from bara_edu_anon`.
- 맨 위에 `set role bara_edu_service;` 를 넣어 모든 객체가 `bara_edu_service` 소유가 되게 하고, 맨 아래에서 `reset role;`.
- `03-grants.sql`: Supabase 기본 권한을 그대로 재현 — `bara_edu_anon`, `bara_edu_authenticated`에 `public` 스키마 usage, 모든 테이블 `select, insert, update, delete`, 모든 시퀀스 usage, 모든 함수 execute를 준 뒤, `02-schema.sql`에 있는 revoke 7줄을 **다시 한 번** 적용한다(전체 grant가 revoke를 덮어쓰지 않게 순서 고정).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// api/test/db-schema.test.ts
import { readFileSync } from 'node:fs';
const ported = readFileSync('db/02-schema.sql', 'utf8');
const original = readFileSync('../supabase/schema.sql', 'utf8');

test('포팅본에 storage·cron·supabase 역할 이름이 없다', () => {
  expect(ported).not.toMatch(/\bstorage\./);
  expect(ported).not.toMatch(/\bcron\.|pg_cron/);
  expect(ported).not.toMatch(/\b(from|to)\s+(public,\s*)?(anon|authenticated|service_role)\b/);
});
test('정책 수 = 원본 정책 수 - storage 정책 4개', async () => {
  const originalCount = (original.match(/^\s*create policy /gim) ?? []).length;
  const { rows } = await adminPool.query("select count(*)::int n from pg_policies where schemaname='public'");
  expect(rows[0].n).toBe(originalCount - 4);
});
test('RLS가 켜진 public 테이블의 소유자는 모두 bara_edu_service', async () => {
  // pg_tables where schemaname='public' → tableowner 전부 'bara_edu_service'
});
test('purge 함수는 authenticated가 실행할 수 없다', async () => {
  // set local role bara_edu_authenticated; select public.purge_unverified_signups() → 42501
});
test('auth.users insert 시 profiles 행이 생긴다(handle_new_user)', async () => {
  // raw_user_meta_data {name:'홍길동', phone:'010'} → profiles.name='홍길동', role='learner', status='active', email 복제
});
test('스키마를 두 번 적용해도 성공', async () => {});
```

- [ ] **Step 2: `npm test -- db-schema` → FAIL 확인**
- [ ] **Step 3: 포팅 규칙대로 `02-schema.sql`, `03-grants.sql` 작성.** PG18에서 깨지는 구문이 나오면 포팅본만 고치고, 고친 내용을 파일 맨 위 주석 "PG18 포팅 변경 목록"에 한 줄씩 적는다.
- [ ] **Step 4: `npm test -- db-schema` → PASS**
- [ ] **Step 5: Commit** — `feat(api): 스키마 포팅과 명시적 권한`

---

### Task 4: RLS 실행기

**Files:**
- Create: `api/src/db/context.ts`
- Test: `api/test/db-context.test.ts`, `api/test/rls-regression.test.ts`

**Interfaces:**
- Consumes: `pg.Pool`, Task 2·3의 역할과 스키마.
- Produces:
  - `type Tx = { query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> }`
  - `withUser<T>(pool: pg.Pool, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>` — `BEGIN; SET LOCAL ROLE bara_edu_authenticated; set_config('request.user_id', userId, true)`.
  - `withAnon<T>(pool, fn): Promise<T>` — `SET LOCAL ROLE bara_edu_anon`, user_id 미설정.
  - `withService<T>(pool, fn): Promise<T>` — `SET LOCAL ROLE bara_edu_service`(RLS 우회, 기존 service_role 대체).
  - 세 함수 모두: 성공 시 COMMIT, 예외 시 ROLLBACK 후 재throw, 항상 연결 반환. `userId`가 UUID 형식이 아니면 쿼리 전에 throw.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// api/test/db-context.test.ts
test('예외 뒤 같은 연결에 권한·id가 남지 않는다 (Review Focus 2)', async () => {
  const one = new Pool({ connectionString, max: 1 });           // 연결 1개로 재사용 강제
  await expect(withUser(one, userA, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  const r = await withAnon(one, (tx) => tx.query('select auth.uid() u, current_user cu'));
  expect(r.rows[0]).toEqual({ u: null, cu: 'bara_edu_anon' });
});
test('UUID가 아닌 userId는 거절', async () => {
  await expect(withUser(pool, "x'; drop table profiles;--", async () => 1)).rejects.toThrow(/userId/);
});
test('withService 안에서는 current_user가 bara_edu_service', async () => {});
```

```ts
// api/test/rls-regression.test.ts  — 시드: 학습자 A, 학습자 B, 관리자 M (adminPool로 auth.users insert, M은 profiles.role='admin')
test('학습자는 자기 profiles만 본다', async () => {
  const rows = await withUser(pool, A, (tx) => tx.query('select id from profiles'));
  expect(rows.rows.map((r) => r.id)).toEqual([A]);
});
test('학습자는 자기 role을 admin으로 못 바꾼다', async () => {
  await withUser(pool, A, (tx) => tx.query("update profiles set role='admin' where id=$1", [A]));
  const r = await adminPool.query('select role from profiles where id=$1', [A]);
  expect(r.rows[0].role).toBe('learner');
});
test('익명은 profiles를 한 줄도 못 본다', async () => { /* withAnon → 0 rows */ });
test('관리자는 모든 profiles를 본다', async () => { /* withUser(M) → 3 rows */ });
test('bank_accounts: 로그인 회원은 조회 가능, 익명은 0줄', async () => {});
test('admin_access_logs: 학습자는 insert 불가', async () => { /* 42501 또는 RLS 위반 */ });
```

- [ ] **Step 2: `npm test -- db-context rls-regression` → FAIL 확인**
- [ ] **Step 3: `context.ts` 구현** — 세 함수는 내부 `run(pool, role, userId | null, fn)` 하나를 공유.
- [ ] **Step 4: 테스트 PASS**
- [ ] **Step 5: Commit** — `feat(api): RLS 실행기와 권한 회귀 테스트`

---

### Task 5: 비밀번호와 세션

**Files:**
- Create: `api/src/auth/passwords.ts`, `api/src/auth/sessions.ts`
- Test: `api/test/passwords.test.ts`, `api/test/sessions.test.ts`

**Interfaces:**
- Consumes: `withService`, `auth.sessions`.
- Produces:
  - `hashPassword(plain: string): Promise<string>` — bcryptjs, cost 10.
  - `verifyPassword(plain: string, hash: string | null): Promise<'ok' | 'mismatch' | 'unsupported'>` — `hash`가 null/빈 문자열이거나 `$2a$`·`$2b$`·`$2y$`로 시작하지 않으면 `'unsupported'`.
  - `createSession(pool, userId: string, ttlDays: number): Promise<{ token: string; expiresAt: Date }>` — 토큰은 32바이트 난수 base64url, DB에는 sha256 hex만 저장.
  - `resolveSession(pool, token: string, ttlDays: number): Promise<{ userId: string; expiresAt: Date } | null>` — 만료·없음이면 null. 남은 기간이 `ttlDays/2` 미만이면 `expires_at`을 `now()+ttlDays`로 연장.
  - `revokeSession(pool, token: string): Promise<void>`, `revokeAllSessions(pool, userId: string): Promise<void>`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// api/test/passwords.test.ts
const SUPABASE_STYLE = '$2a$10$' + /* bcryptjs로 'correct-horse'를 $2a$ cost 10으로 미리 만든 고정 해시 */;
test('Supabase 형식($2a$10$) 해시를 검증한다', async () => {
  expect(await verifyPassword('correct-horse', SUPABASE_STYLE)).toBe('ok');
  expect(await verifyPassword('wrong', SUPABASE_STYLE)).toBe('mismatch');
});
test.each([null, '', 'plaintext', '$argon2id$v=19$m=65536'])('bcrypt가 아니면 unsupported: %s', async (h) => {
  expect(await verifyPassword('x', h)).toBe('unsupported');   // Review Focus 5
});
```

```ts
// api/test/sessions.test.ts
test('발급한 토큰으로 조회되고 DB에는 평문 토큰이 없다', async () => {});
test('만료된 세션은 null', async () => { /* adminPool로 expires_at을 과거로 */ });
test('남은 기간이 절반 미만이면 연장된다', async () => {});
test('revokeAllSessions 뒤에는 모든 토큰이 null', async () => {});
test('회원이 삭제되면 세션도 사라진다(cascade)', async () => {});
```

- [ ] **Step 2: FAIL 확인** → **Step 3: 구현** → **Step 4: PASS**
- [ ] **Step 5: Commit** — `feat(api): 비밀번호 검증과 세션`

---

### Task 6: 서비스 키 가드와 세션 조회 경로

**Files:**
- Create: `api/src/http/guard.ts`, `api/src/auth/routes.ts`(세션 경로만)
- Modify: `api/src/app.ts`
- Test: `api/test/guard.test.ts`, `api/test/auth-session.test.ts`

**Interfaces:**
- Consumes: `resolveSession`, `withService`.
- Produces:
  - 요청 헤더: `x-bara-service-key`(필수), `x-bara-session`(선택, 세션 토큰), `x-bara-client-ip`(선택, 요청 수 제한 키).
  - Fastify 데코레이터 `request.auth: { userId: string | null }`.
  - 오류 응답 형식(전 경로 공통): `{ error: { code: string; message: string } }`. 코드: `unauthorized_service`(401), `unauthenticated`(401), `forbidden`(403), `validation`(400), `rate_limited`(429), `not_found`(404), `internal`(500 — message는 고정 문구, 내부 오류 문자열 노출 금지).
  - `GET /v1/auth/session` → 200 `{ user: { id, email, emailConfirmedAt }, profile: { role, status } | null }` 또는 401 `unauthenticated`. **쿼리 1회**(users left join profiles).
  - 본문 크기 상한 1MB(Fastify `bodyLimit`).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// api/test/guard.test.ts
test.each([undefined, '', 'wrong-key'])('서비스 키 %s → 401 unauthorized_service', async (k) => {});
test('길이가 다른 키도 예외 없이 401 (timingSafeEqual 길이 불일치 처리)', async () => {});
test('500 응답에 내부 오류 문자열이 없다', async () => { /* 핸들러가 throw new Error('pg: secret') → body에 'secret' 없음 */ });
```

```ts
// api/test/auth-session.test.ts
test('유효한 세션 → user와 profile(role,status)', async () => {});
test('세션 헤더 없음/틀림/만료 → 401 unauthenticated', async () => {});
test('탈퇴 회원 세션 → 200 이고 profile.status === "withdrawn" (Review Focus 4)', async () => {});
test('auth.users가 삭제된 세션 → 401', async () => {});
```

- [ ] **Step 2: FAIL 확인** → **Step 3: 구현** → **Step 4: PASS**
- [ ] **Step 5: Commit** — `feat(api): 서비스 키 가드와 세션 조회`

---

### Task 7: 가입·이메일 인증·재발송

**Files:**
- Create: `api/src/mail/mailer.ts`, `api/src/auth/tokens.ts`, `api/src/auth/rate-limit.ts`, `api/src/auth/service.ts`
- Modify: `api/src/auth/routes.ts`, `api/src/app.ts`
- Test: `api/test/auth-signup.test.ts`, `api/test/rate-limit.test.ts`

**Interfaces:**
- Produces:
  - `interface Mailer { send(msg: { to: string; template: 'confirm' | 'recovery'; link: string }): Promise<void> }`, `class MemoryMailer implements Mailer { sent: Array<{ to; template; link }> }`. (SES 구현은 2차 계획.)
  - `issueEmailToken(pool, userId, purpose: 'confirm' | 'recovery'): Promise<string>` — 유효기간 confirm 24시간, recovery 1시간. DB에는 sha256만.
  - `consumeEmailToken(pool, token, purpose): Promise<string | null>` — 성공 시 userId, `used_at` 기록. 만료·사용됨·용도 불일치·없음이면 null.
  - `hit(pool, bucket: string, key: string, limit: number, windowSeconds: number): Promise<boolean>` — 한도 안이면 기록하고 true, 넘으면 false.
  - `normalizeEmail(raw: string): string` — trim + 소문자.
  - `POST /v1/auth/signup` body `{ email, password, name, phone?: string | null, origin: string }`
    - `origin`이 `config.siteOrigins`에 없으면 400 `validation`.
    - 새 계정 → 200 `{ status: 'pending_confirmation' }`, 메일 1통(`link = ${origin}/auth/confirm?token=…`).
    - 이미 있는 이메일 → 200 `{ status: 'already_registered' }`, 메일 없음. (지금 앱이 "이미 가입된 이메일이에요"를 보여주는 동작과 동일 — 설계 문서 §4의 "노출 방지" 표현은 부정확했고, 기존 동작 유지가 맞다.)
    - 제한: IP당 1시간 10회(`signup`), 넘으면 429.
  - `POST /v1/auth/resend` body `{ email, origin }` → 항상 200 `{ status: 'pending_confirmation' }`(계정 없음·이미 인증됨이어도 같은 응답, 메일은 미인증 계정에만). 제한: 이메일당 60초 1회 + 1시간 4회 — 넘으면 **429가 아니라 같은 200**(존재 여부 노출 방지), 메일만 보내지 않는다.
  - `POST /v1/auth/verify-email` body `{ token }` → 200 `{ sessionToken, expiresAt }`(인증 즉시 로그인 — 기존 동작), 실패 400 `validation` code 세부 `invalid_token`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// api/test/auth-signup.test.ts
test('가입 → pending_confirmation, 확인 메일 1통, profiles 생성(name, phone)', async () => {});
test('대소문자·공백만 다른 이메일로 재가입 → already_registered, 메일 없음 (Review Focus 1)', async () => {
  await signup({ email: 'User@Bara-Edu.kr ' }); const r = await signup({ email: 'user@bara-edu.kr' });
  expect(r.json()).toEqual({ status: 'already_registered' }); expect(mailer.sent).toHaveLength(1);
});
test('비밀번호 7자 → 400 validation, 이름 1자 → 400 validation', async () => {});
test('허용되지 않은 origin → 400', async () => { /* origin: 'https://evil.example' */ });
test('메일 링크의 토큰으로 verify-email → 세션 발급, email_confirmed_at 채워짐', async () => {});
test('같은 토큰 두 번째 사용 → 400 invalid_token (Review Focus 3)', async () => {});
test('만료된 토큰 → 400 invalid_token', async () => {});
test('recovery 용도 토큰으로 verify-email → 400 invalid_token', async () => {});
test('resend: 없는 이메일도 200 동일 응답, 메일 0통', async () => {});
test('resend: 60초 안에 두 번 → 둘 다 200, 메일은 1통', async () => {});
```

```ts
// api/test/rate-limit.test.ts
test('limit 3: 네 번째 hit은 false, 창이 지나면 다시 true', async () => {});
```

- [ ] **Step 2: FAIL 확인** → **Step 3: 구현** (입력 검증은 zod, 가입은 `withService`로 `auth.users` insert — profiles는 트리거가 만든다) → **Step 4: PASS**
- [ ] **Step 5: Commit** — `feat(api): 가입·이메일 인증·재발송`

---

### Task 8: 로그인·로그아웃·비밀번호 변경·재설정

**Files:**
- Modify: `api/src/auth/service.ts`, `api/src/auth/routes.ts`
- Test: `api/test/auth-login.test.ts`, `api/test/auth-password.test.ts`

**Interfaces:**
- Consumes: Task 5·7의 함수.
- Produces:
  - `POST /v1/auth/login` `{ email, password }` → 200 `{ sessionToken, expiresAt, userId }`
    - 실패는 모두 401 `unauthenticated`이고 세부 코드만 다르다: `invalid_credentials`(없는 계정·비밀번호 틀림 — 응답 동일), `email_not_confirmed`, `password_reset_required`(`verifyPassword`가 `'unsupported'`).
    - 없는 계정일 때도 더미 해시로 bcrypt 비교를 1회 수행(응답 시간 차이 축소).
    - 제한: 이메일당 실패 15분 10회 → 429.
  - `POST /v1/auth/logout` (세션 필요) → 200 `{ ok: true }`, 해당 세션만 폐기.
  - `POST /v1/auth/change-password` (세션 필요) `{ currentPassword, newPassword }` → 200; 현재 비밀번호 틀리면 403 `forbidden`. 성공 시 **다른 세션은 모두 폐기, 현재 세션은 유지**.
  - `POST /v1/auth/request-reset` `{ email, origin }` → 항상 200 `{ ok: true }`. 계정이 있으면 메일(`link = ${origin}/reset-password?token=…`). 제한은 resend와 동일.
  - `POST /v1/auth/reset-password` `{ token, newPassword }` → 200 `{ ok: true }`, 그 회원의 모든 세션 폐기, `email_confirmed_at`이 비어 있으면 채운다(메일 수신 = 소유 확인).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// api/test/auth-login.test.ts
test('대소문자 다른 이메일로 로그인 성공 (Review Focus 1)', async () => {});
test('없는 계정과 틀린 비밀번호의 응답 본문이 완전히 같다', async () => {});
test('미인증 계정 → 401 email_not_confirmed', async () => {});
test('해시가 null/argon2 → 401 password_reset_required, 500 아님 (Review Focus 5)', async () => {});
test('Supabase에서 옮긴 $2a$ 해시 계정으로 로그인 성공', async () => { /* adminPool로 auth.users에 고정 해시 insert */ });
test('실패 11번째 → 429 rate_limited', async () => {});
test('logout 뒤 같은 토큰으로 /v1/auth/session → 401', async () => {});
```

```ts
// api/test/auth-password.test.ts
test('change-password: 현재 비밀번호 틀리면 403, 맞으면 새 비밀번호로 로그인됨', async () => {});
test('change-password 성공 시 다른 기기 세션은 401, 현재 세션은 유지', async () => {});
test('request-reset: 없는 이메일도 200, 메일 0통', async () => {});
test('reset-password 성공 → 기존 세션 전부 폐기, 새 비밀번호 로그인', async () => {});
test('confirm 용도 토큰으로 reset-password → 400 invalid_token (Review Focus 3)', async () => {});
test('새 비밀번호 7자 → 400', async () => {});
```

- [ ] **Step 2: FAIL 확인** → **Step 3: 구현** → **Step 4: PASS**
- [ ] **Step 5: Commit** — `feat(api): 로그인·비밀번호 변경·재설정`

---

### Task 9: 관리자용 회원 인증 관리

**Files:**
- Modify: `api/src/auth/service.ts`, `api/src/auth/routes.ts`
- Test: `api/test/auth-admin.test.ts`

**Interfaces:**
- Consumes: 세션 → `withUser`로 `select public.is_admin()` 확인 후 `withService`로 실행.
- Produces (기존 `auth.admin.*` 호출 4종의 대체):
  - `POST /v1/admin/users/:id/confirm-email` → 200 (기존 `updateUserById(id, { email_confirm: true })`).
  - `POST /v1/admin/users/:id/send-reset` `{ origin }` → 200 (기존 `resetPasswordForEmail`).
  - `GET /v1/admin/users/confirmations` → 200 `{ items: Array<{ id: string; emailConfirmedAt: string | null }> }` (기존 `listUsers` 순회 대체 — 한 번의 쿼리).
  - `POST /v1/auth/withdraw-anonymize` (본인 세션) `{ anonymizedEmail }` → 200. `auth.users.email`을 바꾸고 비밀번호를 무작위 값의 해시로, `raw_user_meta_data`를 `{}`로, 그 회원의 모든 세션 폐기(기존 `updateUserById` + `admin.signOut(global)`). `anonymizedEmail`은 `@withdrawn.invalid`로 끝나야 한다(아니면 400).
  - 관리자가 아니면 403 `forbidden`, 대상 없음 404.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('학습자가 confirm-email 호출 → 403, email_confirmed_at 그대로', async () => {});
test('관리자가 confirm-email → 대상 회원 로그인 가능해짐', async () => {});
test('confirmations: 회원 3명의 id와 인증 시각', async () => {});
test('withdraw-anonymize: 이메일 변경, 기존 비밀번호 로그인 불가, 세션 전부 폐기', async () => {});
test('withdraw-anonymize: 도메인이 다르면 400', async () => {});
test('없는 회원 id → 404, UUID가 아닌 id → 400', async () => {});
```

- [ ] **Step 2: FAIL 확인** → **Step 3: 구현** → **Step 4: PASS**
- [ ] **Step 5: Commit** — `feat(api): 관리자용 회원 인증 관리`

---

### Task 10: 오퍼레이션 등록 구조와 예시

2차 계획이 기존 `.from()` 호출 약 215곳과 RPC 16개를 옮길 틀이다. 이 태스크는 틀과 예시 2개만 만든다.

**Files:**
- Create: `api/src/ops/registry.ts`, `api/src/ops/profiles.ts`, `api/src/ops/routes.ts`, `api/README.md`
- Modify: `api/src/app.ts`
- Test: `api/test/ops.test.ts`

**Interfaces:**
- Produces:
  - `type OpAccess = 'anon' | 'user' | 'service'` — `'anon'`: 세션이 있으면 `withUser`, 없으면 `withAnon`. `'user'`: 세션 필수, `withUser`. `'service'`: 세션 필수 + 핸들러가 직접 권한 확인 후 `withService`(기존 service_role 사용처 전용).
  - `defineOp<P, R>(def: { name: string; access: OpAccess; params: z.ZodType<P>; run(ctx: { tx: Tx; userId: string | null }, params: P): Promise<R> }): Op`
  - `registerOps(ops: Op[]): Registry` — 이름 중복이면 throw.
  - `POST /v1/op/:name` body `{ params }` → 200 `{ data: R }`. 없는 이름 404, params 검증 실패 400, `'user'`인데 세션 없음 401.
  - 예시: `profiles.getMine`(`user`, `select id, name, phone, role, status, email from profiles where id = auth.uid()` → 한 줄 또는 null), `bank_accounts.list`(`user`).
  - 이름 규칙: `<테이블 또는 도메인>.<동사>` 소문자·점 하나.
  - `api/README.md`: 로컬 실행·테스트 방법, 환경변수 표, 오퍼레이션 추가 방법, 경로 목록.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('profiles.getMine: 본인 행만', async () => {});
test('세션 없이 user 오퍼레이션 → 401', async () => {});
test('없는 오퍼레이션 → 404, params 형식 오류 → 400', async () => {});
test('오퍼레이션 안에서 예외 → 500 internal, 다음 요청에 권한 누수 없음', async () => {});
test('이름이 중복이면 registerOps가 throw', () => {});
```

- [ ] **Step 2: FAIL 확인** → **Step 3: 구현** → **Step 4: `npm test` 전체 PASS, `npm run build` 성공**
- [ ] **Step 5: Commit** — `feat(api): 오퍼레이션 등록 구조와 예시`

---

## 완료 기준(1차)

- `cd api && npm run db:up && npm test` 전체 통과, `npm run build` 성공.
- `git status`에 `api/`·`docs/` 밖 변경 없음(`infra/supabase-aws/`의 기존 미커밋 변경 제외).
- 운영 앱·Supabase·AWS에 아무 변화 없음.
