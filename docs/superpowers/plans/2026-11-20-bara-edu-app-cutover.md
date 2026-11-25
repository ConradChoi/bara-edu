# bara-edu 2차: 범용 조회 통로 + 앱 교체 + S3·SES + 이관 스크립트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Next 앱이 Supabase 없이 1차 API(`api/`)만으로 지금과 같게 동작하고, 운영 데이터를 옮길 스크립트가 로컬에서 검증된 상태를 만든다.

**Architecture:** API에 Supabase 쿼리 빌더와 같은 모양의 요청을 받는 범용 통로(`POST /v1/query`, `POST /v1/rpc/:fn`)를 추가한다. 요청은 회원 세션 역할(`withUser`/`withAnon`)로 실행되고, 누가 무엇을 보는지는 기존 RLS·grant가 막는다(대표 결정 2026-11-20 "범용 조회 통로"). 앱은 `@supabase/*` 대신 같은 체이닝 API를 흉내 내는 얇은 클라이언트(`lib/db/*`)를 쓰므로 69개 파일 대부분은 import만 바뀐다. 인증·사진·탈퇴처럼 Supabase Auth/Storage/service_role에 기대던 곳만 1차 인증 경로와 새 저장소 경로로 다시 짠다.

**Tech Stack:** API — Fastify 5, pg 8, zod, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-sesv2`, Vitest. 앱 — Next.js 16.2.7(App Router, `proxy.ts`), `@aws-sdk/client-ssm`, Vitest(앱 단위 테스트용으로 새로 추가).

**Spec:** `docs/superpowers/specs/2026-11-12-bara-edu-supabase-exit-design.md` (승인 2026-11-20). 1차 계획: `docs/superpowers/plans/2026-11-12-bara-edu-api-foundation.md`.

**일정(대표 결정 2026-11-20: 11/24(화) 새 시스템 오픈)**
- 11/21(토)~11/22(일): 이 계획 Task 1~12.
- 11/23(월): 3차 런북(맨 아래) — 공용 서버 설치(각 항목 대표 확인), 리허설.
- 11/24(화): 점검 → 이관 → 전환 → 확인. 리허설이 통과하지 못하면 전환을 미루고 공지(`data/notice-config.ts` `endsAt`)를 연장한다.

## Global Constraints

- 1차 Global Constraints 전부 유지(역할 이름·접두어, `bara_edu_app` 비소유, `CONNECTION LIMIT 20`·`statement_timeout 15s`, pg_cron·storage 스키마 없음, 모든 경로 `x-bara-service-key`, bcrypt cost 10, 비밀번호 8자·이름 2자).
- 오류 형식 `{ error: { code, message } }`. `internal` 500은 내부 오류 문구를 내보내지 않는다. 예외: DB가 의도적으로 돌려주는 오류(SQLSTATE `23xxx` 제약 위반, `P0001` `raise exception`, `42501` 권한 거부)는 `{ error: { code: 'db_error', message: <pg message>, sqlstate } }`로 그대로 전달한다(앱이 `23505`, `'bank account limit reached'`, `'result not found'`를 검사한다).
- 범용 통로는 **회원 세션 역할로만** 실행한다(`withUser` 또는 `withAnon`). 범용 통로에서 `withService`는 절대 쓰지 않는다. RLS 우회가 필요한 곳은 이름 붙은 op(1차 `defineOp`, access `'service'`)로만 만든다.
- 범용 통로의 테이블·열·관계 이름은 DB 카탈로그(`public` 스키마)에 있는 것만 허용하고, 값은 전부 바인딩 파라미터로 보낸다. 식별자는 항상 `"..."` 로 감싼다.
- 응답 JSON 모양은 Supabase(PostgREST)와 같게: 결과는 SQL 안에서 `json_agg`로 만들고 트랜잭션마다 `set local timezone = 'UTC'` (timestamptz → `"2026-11-20T12:00:00.123+00:00"`, numeric → JSON 숫자, 관계는 1:1이면 객체 또는 `null`, 1:N이면 배열).
- 앱은 Task 11 이후 `@supabase/*`를 import하지 않는다. `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`를 읽지 않는다.
- 서버 간 비밀키: 앱은 운영에서 SSM Parameter Store `/bara-edu/api/service-key`(SecureString)를 Amplify 컴퓨트 역할로 읽는다(대표 결정 2026-11-20). 로컬·테스트는 `BARA_API_SERVICE_KEY` 환경변수. 빌드 산출물·`.env.production`에 키를 쓰지 않는다.
- 세션 쿠키 이름 `bara_session`, `httpOnly`, `secure`(운영), `sameSite: 'lax'`, `path: '/'`, 만료는 API가 준 `expiresAt`.
- 사진: S3 비공개 버킷, 객체 키는 기존과 같은 `<회원 uid>/<파일명>`, 서명 URL 유효 60초, 업로드 최대 5MB, `image/jpeg`·`image/png`·`image/webp`만.
- 메일: SES(서울), 발신 `바라평생교육원 <no-reply@bara-edu.kr>`. 링크는 1차 그대로(`/auth/confirm?token=`, `/reset-password?token=`).
- 커밋 대상: `api/`, `app/`, `lib/`, `components/`, `data/`, `package.json`, `package-lock.json`, `vitest.config.ts`(루트), `docs/`. `supabase/schema.sql`·`supabase/seed.sql`은 수정하지 않는다(운영 Supabase가 전환 전까지 쓴다).
- 이 계획 실행 중에는 운영 Supabase·AWS에 접속하지 않는다. S3·SES·SSM은 가짜 구현으로 테스트한다.
- main에 커밋·push하지 않는다. 브랜치 `feat/app-cutover`에서 작업한다(전환 전 사이트에 반영되면 안 된다 — 머지는 11/24 전환 절차의 일부).

## Review Focus

1. **로그인한 채 다른 회원 데이터 조회**: 회원 A의 세션으로 `from('enrollments').select('*')`(필터 없음) → A의 행만 와야 한다(RLS). 관계 포함 조회 `profiles(name)`로 남의 프로필이 새면 안 된다. → Task 1 테스트.
2. **관계가 비어 있는 행**: `certificates`의 `courses(title)`에서 강좌가 지워졌거나 FK가 null → `courses: null`(빈 객체 아님). 1:N 관계에 자식이 없으면 `[]`. → Task 1 테스트.
3. **검색어 특수문자**: 관리자 회원 검색 `or(name.ilike.%q%,email.ilike.%q%)`에 `,` `(` `)` `%` `_` `'` 가 들어간 입력 → 오류 없이 문자 그대로 검색되거나(이스케이프) 빈 결과, SQL 주입 없음. → Task 1(API)·Task 8(빌더 파서) 테스트.
4. **세션 만료·탈퇴 중 페이지 이동**: 쿠키의 세션이 API에서 사라졌거나 탈퇴 상태 → `proxy.ts`가 쿠키를 지우고 `/sign-in`으로 보낸다. 공개 페이지는 로그인 안 한 상태로 정상 표시. → Task 9 테스트.
5. **사진 업로드 경계**: 5MB 초과, 이미지가 아닌 파일, 다른 회원 경로로 업로드 시도 → 400/403, 기존 사진 유지. → Task 4 테스트.

---

## File Structure

```
api/
  src/query/
    select-parser.ts      'a, b, rel(c, d)' 문자열 → 트리 (1단계 관계만)
    catalog.ts            public 스키마 테이블·열·FK 캐시 (기동 시 1회 + 테스트용 재로딩)
    build.ts              QueryRequest → { text, values }
    routes.ts             POST /v1/query, POST /v1/rpc/:fn
    db-error.ts           pg 오류 → 전달 가능한 오류 판정
  src/storage/
    storage.ts            Storage 인터페이스 + MemoryStorage
    s3.ts                 S3Storage
    routes.ts             /v1/storage/member-photos/*
  src/mail/ses.ts         SesMailer + 한국어 템플릿
  src/jobs/scheduler.ts   일일 정리 작업
  src/ops/account.ts      account.withdrawCleanup
  db/apply.ts → 역할 생성(bootstrap)과 스키마 적용(migrate) 분리
  scripts/migrate-from-supabase.ts   운영 데이터 이관
lib/db/
  api.ts                  apiFetch (서버 전용, 키·세션·IP 헤더)
  service-key.ts          SSM 조회 + 캐시
  session-cookie.ts       bara_session 읽기·쓰기·삭제
  query-builder.ts        Supabase 호환 체이닝 빌더 (from/select/eq/... /rpc)
  or-parser.ts            PostgREST or() 문자열 → 필터 트리
  server.ts               createClient() — { from, rpc, auth.getUser } (기존 lib/supabase/server.ts 대체)
  auth.ts                 signUp/login/logout/... 1차 인증 경로 래퍼
  storage.ts              사진 업로드·삭제·서명 URL 래퍼
app/auth/confirm/route.ts             인증 메일 링크 처리
```

`lib/supabase/*` 중 `queries.ts`, `classroom-queries.ts`, `diagnosis-queries.ts`, `admin-queries.ts`, `admin-pii-reveal.ts`, `require-admin.ts`는 내용이 쿼리 함수라 **경로 그대로 두고 import만** `@/lib/db/server`로 바꾼다(파일 이동은 이번 범위 밖). `lib/supabase/server.ts`, `client.ts`, `admin.ts`, `proxy.ts`는 삭제한다.

---

### Task 1: 범용 조회 — select

**Files:**
- Create: `api/src/query/select-parser.ts`, `api/src/query/catalog.ts`, `api/src/query/build.ts`, `api/src/query/db-error.ts`, `api/src/query/routes.ts`
- Modify: `api/src/app.ts` (라우트 등록, 카탈로그 로드)
- Test: `api/test/query-select.test.ts`, `api/test/select-parser.test.ts`

**Interfaces:**
- Consumes: 1차 `withUser`, `withAnon`, `Tx`, `sendError`, `req.auth.userId`.
- Produces:
  ```ts
  type Filter =
    | { col: string; op: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'like'|'ilike'; value: string|number|boolean }
    | { col: string; op: 'in'; value: (string|number)[] }
    | { col: string; op: 'is'; value: null|true|false; not?: boolean }
    | { or: Filter[] } | { and: Filter[] };
  type QueryRequest = {
    table: string;
    action: 'select'|'insert'|'update'|'upsert'|'delete';
    select?: string;                // Supabase select 문자열, 기본 '*'
    filters?: Filter[];             // AND 결합
    order?: { col: string; ascending: boolean }[];
    limit?: number; offset?: number;
    single?: 'one'|'maybe';
    count?: 'exact'; head?: boolean;
    values?: Record<string, unknown> | Record<string, unknown>[];   // Task 2
    onConflict?: string;                                             // Task 2
    returning?: boolean;                                             // Task 2: .select() 체이닝 여부
  };
  // 응답 200: { data: unknown; count: number | null }
  ```
  - `parseSelect(s: string): SelectNode[]` — `SelectNode = { kind:'col'; name:string } | { kind:'star' } | { kind:'rel'; name:string; children:SelectNode[] }`. 관계 안의 관계는 거부(400).
  - `loadCatalog(pool): Promise<Catalog>` — `Catalog.columns(table): Set<string> | undefined`, `Catalog.relation(from, to): { kind:'one'|'many'; fromCols:string[]; toCols:string[] } | undefined` (FK 방향으로 판정: `from`이 FK를 가지면 one, `to`가 `from`을 가리키면 many. 후보가 둘 이상이면 undefined → 400).
  - `buildSelect(cat, req): { text: string; values: unknown[] }`.
  - `toDbError(err): { status: 400|403; body } | null` — Global Constraints의 SQLSTATE 규칙.
- 단일 행 규칙(Supabase와 동일): `single:'one'`에서 0행 또는 2행 이상 → 406 `{error:{code:'PGRST116', message:'JSON object requested, multiple (or no) rows returned'}}`; `'maybe'`에서 0행 → `data:null`, 2행 이상 → 같은 406. `head:true` → `data:null`, `count` 숫자.
- 쿼리 모양: `select coalesce(json_agg(t), '[]'::json) from (select <열>, (<관계 서브쿼리>) as "<rel>" from "public"."<table>" where ... order by ... limit/offset) t`. 1:1 관계는 `(select json_build_object(...) from rel where rel.<toCol> = t0.<fromCol>)`, 1:N은 `coalesce((select json_agg(json_build_object(...)) from rel where ...), '[]'::json)`. `count:'exact'`는 같은 where로 `count(*)` 별도 실행(한 트랜잭션).
- `ilike`/`like` 값은 앱이 준 패턴 그대로 쓴다(앱이 `%`를 붙인다). `or`·`and`는 재귀.
- `limit` 최대 1000(초과 400). 본문의 알 수 없는 키 → 400.

- [ ] **Step 1: 실패하는 테스트 작성** — 테스트 DB에 회원 A·B, 강좌 1개(카테고리 포함), A의 수강 1건·B의 수강 1건, 수료증(강좌 FK null인 행 1개 포함)을 시드.

```ts
test('parseSelect: 열·별표·1단계 관계', () => {
  expect(parseSelect('id, courses(title, slug)')).toEqual([
    { kind: 'col', name: 'id' },
    { kind: 'rel', name: 'courses', children: [{ kind: 'col', name: 'title' }, { kind: 'col', name: 'slug' }] },
  ]);
  expect(() => parseSelect('a(b(c))')).toThrow();
});
test('A 세션으로 enrollments 전체 select → A 행만', async () => {/* rows.every(r => r.user_id === A) && length 1 */});
test('익명으로 enrollments → []', async () => {});
test('to-one 관계: enrollments의 courses(title, slug, fee) → 객체, fee는 number', async () => {});
test('to-one 관계가 없는 행 → null', async () => {});
test('to-many 관계: quiz_questions의 quiz_options(...) → 배열, 자식 없으면 []', async () => {});
test('timestamptz는 "+00:00" ISO 문자열', async () => {});
test('eq/in/is null/not is null/gte/lte/ilike/order desc/range', async () => {});
test('or: name.ilike %홍% 또는 email.ilike — 값에 , ( ) \' 가 있어도 안전', async () => {});
test('count exact + head → data null, count 숫자', async () => {});
test('single 0행 → 406 PGRST116, maybeSingle 0행 → null', async () => {});
test('없는 테이블·없는 열·관계 안 관계·limit 1001 → 400', async () => {});
test('auth 스키마 테이블(auth.users) 지정 불가 → 400', async () => {});
```

- [ ] **Step 2: `cd api && npm test -- query-select select-parser` → FAIL**
- [ ] **Step 3: 구현** — 카탈로그는 `information_schema.columns`·`pg_constraint`(contype='f')로 `public`만 읽는다. 관계 이름은 대상 **테이블 이름**만 허용(별칭·`!inner` 미지원 — 앱에서 쓰지 않음).
- [ ] **Step 4: `npm test` 전체 PASS, `npm run build` 성공**
- [ ] **Step 5: Commit** — `feat(api): 범용 조회 통로(select)`

---

### Task 2: 범용 조회 — insert/update/upsert/delete

**Files:**
- Modify: `api/src/query/build.ts`, `api/src/query/routes.ts`
- Test: `api/test/query-write.test.ts`

**Interfaces:**
- Consumes: Task 1 `QueryRequest`, `buildSelect`, `toDbError`.
- Produces: `buildWrite(cat, req): { text; values }`.
  - `insert`: `values` 객체 또는 배열. 열 이름은 카탈로그 검사. `returning:true`면 `select` 문자열 모양으로 돌려준다(관계 포함 가능 — `with ins as (insert ... returning *) select ... from ins`), 아니면 `data:null`.
  - `update`: `values` 객체 + `filters` **필수**(없으면 400 — 전체 갱신 방지).
  - `delete`: `filters` **필수**(없으면 400).
  - `upsert`: `onConflict` 열 목록(쉼표) 필수, `insert ... on conflict (...) do update set <values의 열> = excluded.<열>`.
  - 값의 JS 타입 → 바인딩 그대로(배열·객체는 JSON 문자열로 바인딩하고 열 타입이 `json/jsonb`일 때만 허용).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('A가 본인 progress upsert(onConflict user_id,lesson_id) 두 번 → 1행, completed_at 갱신', async () => {});
test('A가 B의 profiles update → 0행 영향, data null, 오류 없음(RLS)', async () => {});
test('filters 없는 update/delete → 400', async () => {});
test('bank_accounts 4번째 insert → 400 db_error, message에 "bank account limit reached"', async () => {});
test('unique 위반 → 400 db_error, sqlstate "23505"', async () => {});
test('insert + returning select "id, created_at" → 새 행 배열', async () => {});
test('비회원 role 승격 시도(profiles.role="admin" update) → 기존 트리거가 막음, 400 또는 403', async () => {});
```

- [ ] **Step 2: FAIL 확인** → **Step 3: 구현** → **Step 4: `npm test` 전체 PASS**
- [ ] **Step 5: Commit** — `feat(api): 범용 조회 통로(쓰기)`

---

### Task 3: RPC 통로

**Files:**
- Modify: `api/src/query/routes.ts`
- Test: `api/test/rpc.test.ts`

**Interfaces:**
- Produces: `POST /v1/rpc/:fn` body `{ args: Record<string, unknown> }` → `{ data }`.
  - 허용 함수(이 목록만, 그 외 404): `submit_quiz_attempt`, `submit_diagnosis_lead`, `submit_diagnosis`, `submit_course_exam`, `set_quiz_correct_option`, `set_course_exam_correct_option`, `publish_legal_document`, `issue_certificate_self`, `get_quiz_for_lesson`, `get_my_exam_reset_at`, `get_my_diagnosis_results`, `get_diagnosis_summary`, `get_diagnosis_detail`, `get_course_exam_readiness`, `get_course_exam`, `claim_diagnosis`.
  - 인자 이름은 `pg_proc.proargnames`로 검사하고 이름 지정 호출(`public.fn("p_a" => $1, ...)`)로 실행.
  - 결과 모양(Supabase와 동일): `returns table`/`setof` → 배열(`json_agg`), 스칼라 → 값, `void` → `null`.
  - 실행 역할은 Task 1과 같다(`withUser`/`withAnon`).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('목록에 없는 함수(purge_unverified_signups) → 404', async () => {});
test('get_course_exam_readiness → [{question_count, has_unresolved_question}]', async () => {});
test('get_my_exam_reset_at 스칼라 → 값 또는 null', async () => {});
test('publish_legal_document 비관리자 → 403 또는 400 db_error', async () => {});
test('모르는 인자 이름 → 400', async () => {});
test('submit_diagnosis 익명 → access_token 포함 배열', async () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS**
- [ ] **Step 5: Commit** — `feat(api): RPC 통로`

---

### Task 4: 사진 저장소(S3)와 탈퇴 정리 op

**Files:**
- Create: `api/src/storage/storage.ts`, `api/src/storage/s3.ts`, `api/src/storage/routes.ts`, `api/src/ops/account.ts`
- Modify: `api/src/app.ts`(deps에 `storage: Storage`), `api/src/config.ts`(`S3_BUCKET`, `AWS_REGION` 기본 `ap-northeast-2`), `api/src/server.ts`, `api/package.json`
- Test: `api/test/storage.test.ts`, `api/test/withdraw-cleanup.test.ts`

**Interfaces:**
- Produces:
  - `interface Storage { put(key: string, body: Buffer, contentType: string): Promise<void>; remove(key: string): Promise<void>; signedUrl(key: string, seconds: number): Promise<string> }`, `MemoryStorage`(테스트용, `objects: Map`), `S3Storage(bucket, region)` — 자격증명은 기본 체인(WAS 인스턴스 역할).
  - `POST /v1/storage/member-photos` (세션 필수) body `{ fileName: string; contentType: string; dataBase64: string }` → `{ path: '<userId>/<fileName>' }`. `fileName`은 `^[A-Za-z0-9._-]{1,100}$`. 이 경로만 `bodyLimit` 8MB.
  - `DELETE`가 아닌 `POST /v1/storage/member-photos/remove` body `{ path }` — 본인 경로 또는 `is_admin()`이면 삭제.
  - `POST /v1/storage/member-photos/signed-url` body `{ path }` → `{ url }` — 본인 경로 또는 관리자만, 60초.
  - 권한 판정: 경로 첫 세그먼트 = 세션 userId, 아니면 `withUser(... select public.is_admin())`.
  - op `account.withdrawCleanup` (access `'service'`, params `{}`): 세션 회원 본인의 `progress`, `quiz_submissions`, `assignment_submissions`, `course_exam_submissions`, `course_exam_attempt_resets`, `diagnosis_leads` 삭제 + `diagnosis_results`의 `respondent_name, phone, email, certificate_level`을 null. 한 트랜잭션. 반환 `{ ok: true }`. 대상 id는 **항상 세션 userId**(params로 받지 않는다).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('본인 경로 업로드 → MemoryStorage에 저장, path 반환', async () => {});
test('5MB 초과·image/gif·잘못된 fileName → 400', async () => {});
test('세션 없음 → 401', async () => {});
test('B가 A 경로 signed-url → 403, 관리자 → url', async () => {});
test('본인 remove 성공, 남의 경로 remove → 403', async () => {});
test('withdrawCleanup: A의 학습 이력·진단 PII만 지워지고 B는 그대로', async () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS**
- [ ] **Step 5: Commit** — `feat(api): 회원 사진 저장소와 탈퇴 정리 op`

---

### Task 5: SES 메일 + 2차 전 필수 항목(요청 제한·응답 시간·로그·스키마 적용)

1차 리뷰가 실서버 투입 전 필수로 남긴 I-5·I-6·I-7·R17을 여기서 닫는다.

**Files:**
- Create: `api/src/mail/ses.ts`
- Modify: `api/src/auth/routes.ts`, `api/src/auth/service.ts`, `api/src/auth/rate-limit.ts` 사용처, `api/src/http/logging.ts`, `api/src/db/apply.ts`, `api/package.json`(scripts), `api/src/server.ts`, `api/README.md`
- Test: `api/test/ses.test.ts`, `api/test/auth-limits.test.ts`, `api/test/apply.test.ts`, `api/test/logging.test.ts`

**Interfaces:**
- Produces:
  - `SesMailer(client: Pick<SESv2Client,'send'>, from: string)` implements `Mailer`. 템플릿:
    - confirm — 제목 `[바라평생교육원] 이메일 인증을 완료해 주세요`, 본문 "아래 링크를 눌러 이메일 인증을 완료해 주세요. 링크는 24시간 동안 유효해요." + 링크.
    - recovery — 제목 `[바라평생교육원] 비밀번호 재설정 안내`, 본문 "아래 링크에서 새 비밀번호를 설정해 주세요. 링크는 1시간 동안 유효해요. 요청하지 않았다면 이 메일을 무시해 주세요." + 링크.
    - HTML·텍스트 둘 다. 링크는 HTML 이스케이프.
  - **응답 시간 평탄화(I-6)**: `signup`·`resend`·`request-reset`·`admin send-reset`의 메일 발송을 응답 뒤로 미룬다 — 라우트는 토큰 발급까지만 기다리고 `mailer.send`는 `setImmediate`로 넘긴 뒤 실패를 이름만 로그. 계정이 없을 때도 같은 양의 DB 작업(같은 테이블 조회 1회 + `rate-limit.hit`)을 한다.
  - **IP 제한(I-6·I-7)**: `x-bara-client-ip` 기준 — `resend`·`request-reset` 각각 IP당 1시간 20회, `login` IP당 15분 50회(초과 429 `rate_limited`). 기존 이메일 기준 제한은 유지.
  - **오류 로그(R17)**: 로그 serializer에서 `err.code`가 있는(pg) 오류는 `message`를 빼고 `code`·`constraint`·`table`만 남긴다.
  - **스키마 적용 분리(I-5)**: `npm run db:bootstrap` = `00-roles.sql`만(관리자 계정으로 1회, 비밀번호는 `BARA_APP_DB_PASSWORD` 환경변수가 있을 때만 설정 — 없으면 비밀번호를 바꾸지 않는다). `npm run db:migrate` = `01~03`(관리자 계정으로, 매번 실행 가능, 역할 비밀번호를 건드리지 않음). 테스트 헬퍼는 둘 다 실행.
  - `server.ts`: `MAIL_FROM` 환경변수가 있으면 `SesMailer`, 없으면 기존 "mailer not configured".

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('SesMailer: confirm 메일의 제목·받는사람·링크·HTML 이스케이프', async () => {/* 가짜 client.send 인자 검사 */});
test('request-reset: 있는 계정과 없는 계정의 응답 본문·상태 동일, 메일은 응답 뒤 발송', async () => {});
test('같은 IP에서 request-reset 21번째 → 429', async () => {});
test('같은 IP에서 서로 다른 이메일로 login 51번째 → 429', async () => {});
test('pg 오류 로그에 message가 없고 code는 있다', async () => {});
test('db:migrate 두 번 실행해도 bara_edu_app 비밀번호 해시(pg_authid 대신 로그인 시도로 확인)가 그대로', async () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: `npm test` 전체 PASS, build 성공**
- [ ] **Step 5: Commit** — `feat(api): SES 메일, IP 기준 요청 제한, 스키마 적용 분리`

---

### Task 6: 일일 정리 작업

**Files:**
- Create: `api/src/jobs/scheduler.ts`
- Modify: `api/src/server.ts`
- Test: `api/test/scheduler.test.ts`

**Interfaces:**
- Produces: `startScheduler(pool, { now?: () => Date; log }): { stop(): void }` — 매일 KST 03:00 `purge_unverified_signups()`, 03:10 `purge_old_admin_access_logs()`, 03:20 `purge_unclaimed_diagnosis_pii()`, 03:30 `purge_old_diagnosis_leads()`를 `withService`로 실행. 실행 전에 `pg_try_advisory_lock(hashtext('bara_edu.jobs.<이름>'))`을 잡지 못하면 건너뛴다(프로세스가 둘이어도 한 번). 결과 건수를 로그. 1분 간격 확인, 같은 날 같은 작업은 한 번.
  - `runJob(pool, name): Promise<number>` — 테스트용으로 export.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('03:00 KST가 된 확인 주기에 purge_unverified_signups 1회만 실행', async () => {});
test('다른 연결이 advisory lock을 잡고 있으면 건너뜀', async () => {});
test('runJob 결과 건수 반환', async () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS**
- [ ] **Step 5: Commit** — `feat(api): 일일 정리 작업 예약 실행`

---

### Task 7: 앱 — API 호출 기반(키·세션 쿠키·IP)

**Files:**
- Create: `lib/db/api.ts`, `lib/db/service-key.ts`, `lib/db/session-cookie.ts`, 루트 `vitest.config.ts`
- Modify: 루트 `package.json`(devDependencies `vitest`, dependencies `@aws-sdk/client-ssm`, script `"test": "vitest run"`), `tsconfig.json`(필요 시 `test/` 포함)
- Test: `test/lib/db/api.test.ts`, `test/lib/db/service-key.test.ts`

**Interfaces:**
- Produces:
  - `getServiceKey(): Promise<string>` — `BARA_API_SERVICE_KEY` 환경변수가 있으면 그것, 없으면 SSM `GetParameter({ Name: process.env.BARA_API_SERVICE_KEY_PARAM ?? '/bara-edu/api/service-key', WithDecryption: true })`, 모듈 메모리에 10분 캐시. 실패 시 throw(키를 로그에 남기지 않는다).
  - `apiFetch<T>(path: string, init: { method?: 'GET'|'POST'; body?: unknown; session?: string | null }): Promise<{ ok: true; data: T } | { ok: false; status: number; error: { code: string; message: string; sqlstate?: string } }>` — 기준 URL `process.env.BARA_API_URL`, 헤더 `x-bara-service-key`, 세션 있으면 `x-bara-session`, 요청 헤더의 `x-forwarded-for` 첫 값을 `x-bara-client-ip`로. 타임아웃 10초. 네트워크 오류는 `{ ok:false, status: 503, error:{code:'unavailable'} }`.
  - `readSession(): Promise<string | null>`, `writeSession(token: string, expiresAt: string): Promise<void>`, `clearSession(): Promise<void>` — `next/headers` `cookies()`, Global Constraints의 쿠키 속성. RSC에서 쓰기 실패는 무시(기존 `server.ts` 주석과 같은 이유).
  - 이 파일들은 첫 줄 `import 'server-only';`.

- [ ] **Step 1: 실패하는 테스트 작성** (`fetch`와 SSM 클라이언트는 `vi.mock`)

```ts
test('apiFetch가 키·세션·클라이언트 IP 헤더를 붙인다', async () => {});
test('API 오류 응답 → ok:false + error 그대로', async () => {});
test('fetch 예외 → 503 unavailable', async () => {});
test('getServiceKey: 환경변수 우선, 없으면 SSM 1회 호출 후 캐시', async () => {});
```

- [ ] **Step 2: `npm test` → FAIL** → **Step 3: 구현** → **Step 4: PASS, `npx tsc --noEmit` 통과**
- [ ] **Step 5: Commit** — `feat(app): API 호출 기반(서비스 키·세션 쿠키)`

---

### Task 8: 앱 — Supabase 호환 쿼리 빌더와 createClient 교체

**Files:**
- Create: `lib/db/query-builder.ts`, `lib/db/or-parser.ts`, `lib/db/server.ts`
- Modify: `@/lib/supabase/server`를 import하는 모든 파일(경로만 `@/lib/db/server`로), `lib/supabase/require-admin.ts`
- Delete: `lib/supabase/server.ts`
- Test: `test/lib/db/query-builder.test.ts`, `test/lib/db/or-parser.test.ts`

**Interfaces:**
- Consumes: Task 7 `apiFetch`, `readSession`; Task 1~3 요청 모양.
- Produces:
  - `createClient(): Promise<DbClient>` — `DbClient = { from(table): QueryBuilder; rpc(fn, args?): Promise<{ data; error }>; auth: { getUser(): Promise<{ data: { user: { id: string; email: string } | null }; error: null }> } }`. `getUser`는 `/v1/auth/session`을 React `cache()`로 요청당 1회.
  - `QueryBuilder` — 앱이 쓰는 메서드만: `select(cols?, { count?: 'exact'; head?: boolean })`, `insert(values)`, `update(values)`, `upsert(values, { onConflict })`, `delete()`, `eq neq gt gte lt lte like ilike in is`, `not(col, 'is', null)`, `or(str)`, `order(col, { ascending })`, `limit(n)`, `range(from, to)`, `single()`, `maybeSingle()`. `await` 가능(thenable) → `{ data, error, count }`. `error`는 `{ code: sqlstate ?? code, message }` (앱의 `error.code === '23505'`, `error.message.includes(...)`가 그대로 동작). 쓰기 뒤 `.select(...)` 호출 시 `returning:true`.
  - `parseOr(s: string): Filter[]` — PostgREST 문법 `col.op.value` 쉼표 구분, `and(...)` 중첩 1단계. 값 안의 `,` `(` `)`는 앱이 이미 `sanitizedQ`로 제거한다는 전제를 두지 말고, 파싱 불가 문자열은 throw.
  - 지원하지 않는 메서드 호출은 TypeScript 타입 오류가 나게 한다(런타임 우회 금지).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("from('enrollments').select('id, courses(title)').eq('user_id', u).order('created_at', {ascending:false}) → 요청 본문", async () => {});
test("select('id', {count:'exact', head:true}) → count만", async () => {});
test('update().eq() 뒤 .select() → returning true', async () => {});
test('API 오류 sqlstate 23505 → error.code "23505"', async () => {});
test("parseOr('status.eq.approved,and(status.eq.pending,payment_due_at.gte.2026-11-20T00:00:00Z)')", () => {});
test("parseOr('name.ilike.%홍길동%,email.ilike.%홍길동%')", () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현 후 import 일괄 교체** (`grep -rl "@/lib/supabase/server" app lib components | xargs sed -i '' 's#@/lib/supabase/server#@/lib/db/server#'`)
- [ ] **Step 4: `npm test` PASS, `npx tsc --noEmit` 통과** — 타입 오류가 나는 호출(빌더가 지원하지 않는 것)은 이 태스크에서 빌더에 추가하거나 호출부를 같은 의미로 고친다. `auth.*` 호출은 Task 9·10에서 다루므로 남은 타입 오류 목록을 보고서에 적는다.
- [ ] **Step 5: Commit** — `feat(app): Supabase 호환 쿼리 빌더로 DB 접근 교체`

---

### Task 9: 앱 — 인증 흐름과 proxy

**Files:**
- Create: `lib/db/auth.ts`, `app/auth/confirm/route.ts`
- Modify: `app/actions/auth.ts`, `app/(auth)/reset-password/page.tsx`, `components/auth/ResetPasswordForm.tsx`, `components/home/NoticeModal.tsx`(해시 검사 제거), `proxy.ts`, 비밀번호 변경을 하는 `app/actions/account.ts` 부분
- Delete: `components/auth/RecoveryRedirect.tsx`(및 그 사용처), `lib/supabase/proxy.ts`, `lib/supabase/client.ts`
- Test: `test/lib/db/auth.test.ts`, `test/proxy.test.ts`

**Interfaces:**
- Consumes: 1차 경로 — `POST /v1/auth/signup {email,password,name,phone,origin}` → `{status:'pending_confirmation'|'already_registered'}`; `resend {email,origin}`; `verify-email {token}` → `{sessionToken, expiresAt}`; `login {email,password}` → `{sessionToken, expiresAt, userId}` / 401 `message: invalid_credentials|email_not_confirmed|password_reset_required` / 429; `logout`; `change-password {currentPassword,newPassword}`; `request-reset {email,origin}`; `reset-password {token,newPassword}`; `GET session` → `{user:{id,email,emailConfirmedAt}, profile:{role,status}|null}`.
- Produces (`lib/db/auth.ts`): `signUp`, `resend`, `verifyEmail`, `login`, `logout`, `changePassword`, `requestReset`, `resetPassword`, `getSession` — 각각 위 경로 1개를 부르고 성공 시 세션 쿠키를 쓰거나 지운다. `origin`은 기존 `getSiteOrigin()`.
- 화면 문구는 기존 그대로. 매핑: `already_registered` → "이미 가입된 이메일이에요. 로그인해 주세요"; 로그인 실패 3종·429 → 기존 "이메일 또는 비밀번호가 올바르지 않아요"(단 `email_not_confirmed`는 기존 인증 안내 상태로, 429는 "잠시 후 다시 시도해주세요").
- `/auth/confirm?token=` → `verifyEmail` 성공 시 쿠키 쓰고 `/my`로, 실패 시 `/sign-in?confirmError=1`(로그인 화면에 기존 "인증 링크가 만료됐어요" 계열 문구 + 재발송 폼).
- 마이페이지 비밀번호 변경(`app/actions/account.ts` `changePassword`): `signInWithPassword` 재검증 + `updateUser` 두 호출을 `change-password {currentPassword,newPassword}` 한 번으로 바꾼다(API가 현재 비밀번호를 검증). 401 → 기존 `?settingsError=current-password-wrong`, 그 외 실패 → `?settingsError=failed`. 성공 시 API가 다른 세션을 끊으므로 현재 쿠키는 유지.
- 재설정 화면은 `?token=`을 hidden input으로 받아 서버 액션 `resetPassword`로 처리, 성공 시 `/sign-in?reset=1`.
- `proxy.ts`: 쿠키 없으면 기존처럼 보호 경로만 `/sign-in?redirect=`; 있으면 `GET /v1/auth/session` 1회 → 401이면 쿠키 삭제 후 보호 경로는 `/sign-in`; `profile.status==='withdrawn'`이면 `logout` 호출 + 쿠키 삭제 + `/sign-in`; `/admin`은 `role==='admin'`만. API 503이면 보호 경로는 `/sign-in`이 아니라 기존 오류 화면(공개 경로는 통과).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('login 성공 → bara_session 쿠키(httpOnly, expires=expiresAt)', async () => {});
test('login email_not_confirmed → pendingConfirmation 상태', async () => {});
test('proxy: 쿠키의 세션이 401 → 쿠키 삭제 + /my 요청은 /sign-in?redirect=/my', async () => {});
test('proxy: withdrawn → 로그아웃·쿠키 삭제·/sign-in', async () => {});
test('proxy: 비관리자 /admin → /', async () => {});
test('proxy: 공개 경로는 쿠키 없어도 통과', async () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS, `npx tsc --noEmit`**
- [ ] **Step 5: Commit** — `feat(app): 자체 인증 흐름과 proxy 교체`

---

### Task 10: 앱 — 탈퇴·사진·관리자 회원 기능

**Files:**
- Create: `lib/db/storage.ts`
- Modify: `app/actions/account.ts`, `app/actions/enrollment.ts`, `app/actions/admin-members.ts`, `app/actions/admin-diagnosis.ts`, `lib/supabase/admin-queries.ts`, `lib/supabase/admin-pii-reveal.ts`, `lib/db/service-key.ts`
- Delete: `lib/supabase/admin.ts`
- Test: `test/actions/withdraw.test.ts`

**Interfaces:**
- Consumes: Task 4 저장소 경로·`account.withdrawCleanup`(`POST /v1/op/account.withdrawCleanup`), 1차 `withdraw-anonymize {anonymizedEmail}`, `logout-all`, `admin/users/:id/confirm-email`, `admin/users/confirmations` → `{items:[{id, emailConfirmedAt}]}`.
- Produces (`lib/db/storage.ts`): `uploadMemberPhoto(file: File): Promise<{ path } | { error }>`, `removeMemberPhoto(path)`, `memberPhotoSignedUrl(path): Promise<string | null>`.
- 탈퇴 순서(1차 R15, 기존 화면·실패 배너 `?withdrawError=failed` 유지):
  1. 사진 경로 읽기(기존 그대로) 2. `withdraw-anonymize`(`withdrawn+<id>@deleted.invalid`) 3. 본인 세션으로 `profiles` update(기존 값 그대로) 4. `account.withdrawCleanup` 5. 사진 삭제(실패 무시, 기존과 같음) 6. `logout-all` 7. 쿠키 삭제.
- 관리자 인증 상태(`admin-queries.ts`의 `listUsers` 순회)는 `confirmations` 한 번 호출로 교체. 서명 URL은 `memberPhotoSignedUrl`.
- 관리자 "이메일 인증 완료 처리" → `admin/users/:id/confirm-email`; "비밀번호 재설정 메일 발송"(`resetPasswordForEmail`) → `admin/users/:id/send-reset {origin}`(`mailSent:false`면 기존 실패 문구).
- PII 열람 토큰 HMAC 키(`lib/supabase/admin-pii-reveal.ts`, 지금은 `SUPABASE_SERVICE_ROLE_KEY` 재사용): 전용 시크릿으로 분리(보안 점검 잔여 권고). 운영은 SSM `/bara-edu/app/pii-reveal-secret`, 로컬은 `BARA_PII_REVEAL_SECRET`. 읽기는 Task 7 `getServiceKey`와 같은 방식의 `getPiiRevealSecret()`를 `lib/db/service-key.ts`에 추가. 키가 없을 때의 기존 실패 처리(목록 화면 유지)는 그대로.

- [ ] **Step 1: 실패하는 테스트 작성** (`apiFetch` 모킹)

```ts
test('withdraw: 경로 호출 순서가 anonymize → profiles update → withdrawCleanup → remove → logout-all', async () => {});
test('withdraw: withdrawCleanup 실패 → /my?withdrawError=failed, logout-all 호출 안 함', async () => {});
test('사진 업로드 6MB → 기존 오류 문구', async () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS, `npx tsc --noEmit`**
- [ ] **Step 5: Commit** — `feat(app): 탈퇴·회원 사진·관리자 인증 상태를 새 API로`

---

### Task 11: Supabase 제거와 로컬 통합 확인

**Files:**
- Modify: `package.json`·`package-lock.json`(`@supabase/ssr`, `@supabase/supabase-js` 제거), `.env.example`(있으면: `BARA_API_URL`, `BARA_API_SERVICE_KEY` 로컬용), `api/test/helpers/seed-dev.ts`(로컬 확인용 시드: 관리자 1, 학습자 1, 카테고리·강좌·레슨·퀴즈·시험 문항 각 1+)
- Create: `docs/superpowers/plans/2026-11-20-cutover-smoke.md`(확인 체크리스트와 결과)
- Test: 전체

- [ ] **Step 1: `grep -rnE "@supabase|NEXT_PUBLIC_SUPABASE|SUPABASE_SERVICE_ROLE" app lib components proxy.ts package.json` → 0건**이 되게 남은 곳을 정리.
- [ ] **Step 2: `npm run build`(루트) 성공, `npm test`(루트) PASS, `cd api && npm test` PASS.**
- [ ] **Step 3: 로컬 통합** — `cd api && npm run db:up && npm run db:bootstrap && npm run db:migrate && node --env-file=.env dist/server.js` + 시드, 루트 `BARA_API_URL=http://localhost:3100 npm run dev`. 체크리스트(각 결과를 smoke 문서에 기록): 가입→MemoryMailer/로그의 인증 링크→`/auth/confirm`→`/my`; 로그아웃·로그인; 비밀번호 변경; 재설정 메일 링크로 재설정; 강좌 목록·상세; 수강 신청(사진 업로드 포함); 관리자 승인; 레슨 진도·퀴즈 제출; 시험 응시; 수료증 발급; 자가진단 제출·결과 조회·회원 귀속; 관리자 회원 목록(인증 상태 표시)·사진 열람·PII 열람 로그; 약관 게시; 탈퇴 후 재로그인 불가.
- [ ] **Step 4: Commit** — `chore(app): Supabase 의존성 제거와 로컬 통합 확인`

---

### Task 12: 운영 데이터 이관 스크립트

**Files:**
- Create: `api/scripts/migrate-from-supabase.ts`, `api/test/migrate.test.ts`
- Modify: `api/package.json`(script `migrate:supabase`), `api/README.md`(실행 절차)

**Interfaces:**
- Produces: `node dist/scripts/migrate-from-supabase.js --source <SOURCE_DATABASE_URL 환경변수 이름> --target <TARGET_DATABASE_URL 환경변수 이름> [--photos]`
  - 원본에서 읽기 전용 트랜잭션(`repeatable read`)으로 `auth.users`(`id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data`)와 `public`의 모든 테이블을 FK 순서로 복사. 대상에서는 `handle_new_user` 등 트리거가 중복 행을 만들지 않게 `auth.users` 적재 시 profiles 자동 생성 트리거를 세션 단위로 끈다(`set local session_replication_role = replica` — RDS 마스터 계정 권한, 3차 런북에서 이 계정으로 실행).
  - 비밀번호 해시 접두어 집계 출력(`$2a$`/`$2b$`/기타 건수). 기타는 1차 `password_reset_required` 경로로 처리되므로 목록만 남긴다(이메일은 출력하지 않고 건수만).
  - 테이블별 건수 대조 + 주요 테이블(`profiles`, `enrollments`, `certificates`, `course_exam_submissions`, `diagnosis_results`)의 `md5(string_agg(id::text, ',' order by id))` 대조. 하나라도 다르면 exit 1.
  - 시퀀스 값 재설정(`setval`).
  - `--photos`: 원본 `profiles.photo_path` 목록을 Supabase Storage에서 받아 S3에 같은 키로 올린다(Supabase 서비스 키·S3 버킷은 환경변수). 건수 대조.
  - 대상 DB가 비어 있지 않으면 시작하지 않는다(`--force` 없음 — 리허설은 새 DB에서).
- 테스트: 테스트 컨테이너 안에 원본 역할의 DB(포팅 스키마 + Supabase식 `auth.users` 열)와 대상 DB를 만들어 시드 → 실행 → 건수·체크섬·로그인(`$2a$` 해시 그대로 1차 `login` 성공) 검증.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('이관 후 테이블별 건수·체크섬 일치, exit 0', async () => {});
test('이관된 $2a$ 해시 계정이 기존 비밀번호로 로그인', async () => {});
test('이관 후 profiles 중복 없음(트리거 미발동)', async () => {});
test('대상 DB가 비어 있지 않으면 시작 거부', async () => {});
test('이메일 미인증 계정도 그대로 이관(email_confirmed_at null)', async () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS**
- [ ] **Step 5: Commit** — `feat(api): 운영 데이터 이관 스크립트`

---

## 완료 기준(2차)

- `cd api && npm test` 전체 통과, 루트 `npm test`·`npm run build` 통과.
- 앱에 `@supabase` 참조 0건(`docs/`, `supabase/`, `infra/` 제외).
- 로컬 통합 체크리스트 전 항목 통과 기록.
- 리뷰: 브랜치 전체 최종 리뷰 + qa-reviewer + privacy-security-officer(개인정보 처리 경로: 탈퇴·사진·진단·관리자 PII). 둘 다 통과해야 3차 전환에 쓴다.

---

## 3차 런북(11/23 월) — 실행 항목마다 대표 확인

코드가 아니라 공용 인프라 작업이라 이 계획의 태스크로 자동 실행하지 않는다. 항목별로 명령·영향·되돌리기를 보여 드리고 확인받은 뒤 실행한다.

1. **ylia-pg-01**: `bara_edu`·`bara_edu_staging` DB 생성, `db:bootstrap`(역할 4개) → `db:migrate`. 파라미터 그룹·재부팅 없음.
2. **SSM**: 두 값 모두 SecureString, **32바이트 이상 난수**(예: `umask 077; openssl rand -base64 48 | tr -d '\n' > <임시 파일>` → `aws ssm put-parameter --type SecureString --value file://<임시 파일>` → 임시 파일 삭제. 화면에 띄우지 않는다. **끝 줄바꿈이 들어가면 안 된다** — 키는 바이트 그대로 비교되고 HTTP 헤더 값에 줄바꿈을 넣을 수 없다).
   - `/bara-edu/api/service-key` — API(WAS)와 앱(Amplify)이 같은 값을 읽는다. **WAS 역할(`ylia-was-role`)은 이 파라미터를 읽는다**(API가 시작 때 `BARA_SERVICE_KEY_PARAM`으로 GetParameter, R22).
   - `/bara-edu/app/pii-reveal-secret` — 앱만 읽는다. **서비스 키와 다른 값**이어야 한다(같은 값 재사용 금지).
3. **IAM**: `ylia-was-role`에 S3(사진 버킷 **이 버킷 하나로 한정**: `arn:aws:s3:::<bucket>/*`의 Get/Put/DeleteObject)·SES 발신(`bara-edu.kr`)·SSM 파라미터 `/bara-edu/api/service-key` 읽기(+`kms:Decrypt`) 권한 추가. Amplify 컴퓨트 역할 생성(SSM 파라미터 2개 `/bara-edu/api/service-key`·`/bara-edu/app/pii-reveal-secret` 읽기만) 후 앱에 연결.
4. **S3**: 비공개 버킷 생성 — 퍼블릭 액세스 차단(4개 모두 on), 기본 암호화(SSE-S3) on, **버전 관리 off**(탈퇴 시 삭제한 사진이 이전 버전으로 남지 않게). 버전 관리를 꼭 켜야 하면 이전 버전을 1일 뒤 만료하는 수명 주기 규칙을 함께 넣는다. IAM의 S3 권한은 이 버킷으로만 한정(3번).
5. **YLIA_WAS_01**: Node 22, `api/` 배포, 설치 직후 남은 메모리 1회 확인(CloudWatch 대신).
   - systemd 유닛: `MemoryMax=256M`, `Restart=always`, `EnvironmentFile=/etc/bara-edu/api.env`. 유닛 파일에는 값(키·URL)을 쓰지 않는다.
   - `/etc/bara-edu/api.env`는 `root:root` `0600`. 내용: `NODE_ENV=production`, `DATABASE_URL`(`bara_edu_app` 역할, `sslmode=verify-full&sslrootcert=<RDS global-bundle.pem 경로>`), `BARA_SERVICE_KEY_PARAM=/bara-edu/api/service-key`, `MAIL_FROM`, `S3_BUCKET`, `AWS_REGION=ap-northeast-2`, `SITE_ORIGINS`, `API_HOST=<WAS 사설 IP>`, `TLS_CERT_FILE`, `TLS_KEY_FILE`, `LOG_LEVEL=info`. **`BARA_DEV_FAKES`는 넣지 않는다**(있으면 API가 시작을 거절). 편집기로 작성하고 `echo`/`export`로 값을 셸에 남기지 않는다.
   - TLS(WEB→WAS 구간 암호화, 대표 결정 11/23): WAS용 내부 인증서를 만든다 — 사설 CA로 발급하거나, 자체 서명 인증서를 WEB 쪽에 고정(pin). 인증서 SAN에 WEB이 접속할 이름(WAS 사설 IP 또는 내부 호스트명)을 넣는다. 개인키는 API 실행 계정만 읽게 한다(소유자 그 계정 `0600`, 또는 `root:<API 그룹>` `0640`). 저장소에 커밋하지 않는다. WEB nginx: `proxy_pass https://<WAS 사설 IP>:3200;` + `proxy_ssl_verify on;` + `proxy_ssl_trusted_certificate <CA 또는 고정한 인증서>;` + `proxy_ssl_name <SAN 이름>;`. 시작 로그에 평문 경고(`TLS is off in production`)가 없어야 한다. 단, `NODE_ENV`가 빠지면 경고 자체가 안 나오므로 경고 부재만으로 판단하지 않는다 — (1) `systemctl show bara-edu-api -p EnvironmentFiles`와 `api.env`에 `NODE_ENV=production`이 있는지 눈으로 확인, (2) WAS에서 `ss -tlnp`로 `<WAS 사설 IP>:3200`에만 열려 있는지 확인, (3) WEB에서 `curl --cacert <CA 또는 고정 인증서> https://<SAN 이름>:3200/healthz`가 TLS로 응답하는지 확인. (실제 설치 11/23: 포트 3200 — 3100은 ylia-stock 사용 중. 배포 경로 `/app/bara-edu/current`, 설정 `/app/bara-edu/shared/api.env`.)
   - `db:migrate`를 돌린 뒤에는 **매번 API를 재시작**한다(테이블·RPC 목록을 캐시한다).
   - 이관 스크립트(`migrate:supabase`)는 운영 배포 디렉터리가 아니라 **별도 체크아웃**(같은 커밋을 다른 경로에 clone, `npm ci`)에서 실행한다. 접속 정보는 `read -s` 또는 0600 파일 `source` 후 삭제(`api/README.md`).
6. **YLIA_WEB_SVR_01**: nginx `api.bara-edu.kr` 서버 블록(요청 수 제한 포함)·인증서, 위 5번의 `proxy_ssl_*` 설정, Jenkins 잡.
7. **DNS**: `api.bara-edu.kr` 레코드.
8. **Amplify**: `feat/app-cutover` 미리보기 브랜치(키는 브랜치 단위로만) + 스테이징 DB로 리허설 — 운영 Supabase 데이터 복사본으로 Task 12 스크립트 실행, 체크리스트 전체(`2026-11-20-cutover-smoke.md`), 리허설 데이터 당일 삭제·기록. 추가 확인:
   - 요청 IP: 앱(Amplify) 쪽에서 실제 `x-forwarded-for` 체인과 `CloudFront-Viewer-Address`를 확인한다. 서로 다른 두 네트워크(예: Wi-Fi와 LTE)에서 요청해 **같은 요청 제한 버킷을 쓰지 않는지** 본다(R11).
   - `SITE_ORIGINS`에 apex(`https://bara-edu.kr`), www(서비스한다면), 미리보기 호스트가 모두 들어 있다.
   - 이관 출력: `not <uid>/photo: 0`, `rejected (not an API photo key): 0`, `null_email=0`. 이와 별도로 원본 `auth.users`에서 **API의 zod 이메일 검사에 걸리는 이메일 수**를 센다(0이 아니면 그 회원은 로그인·재설정이 막히므로 목록을 대표께 보고).
   - 실제 Gmail·Naver 계정으로 가입(인증 메일 수신·링크).
   - 휴대폰 사진 3MB로 수강신청.
   - Amplify 콘솔에 buildSpec 덮어쓰기(override)가 없다(저장소 `amplify.yml`이 쓰인다).
   - `BARA_API_URL`이 `https://api.bara-edu.kr`이다.
   - 이관된 "7일 넘은 미인증 계정" 수를 세어 둔다 — 첫 03:00 KST 정리 작업이 지울 건수다. 예상과 다르면 첫 실행 전에 대표 확인.
9. **11/24 전환**: 점검 화면 → Supabase 쓰기 중단 → 이관(`--photos`) → `feat/app-cutover` main 머지·환경변수 교체(`BARA_API_URL` 추가) → 확인(`전환 직후 수동 확인`) → 점검 해제.
   - **되돌리기 = 머지 전 Amplify 작업 재배포, 또는 머지 커밋 revert**(R23). 머지 후 코드에는 Supabase 경로가 없으므로 환경변수만 Supabase로 바꿔서는 돌아가지 않는다.
   - Amplify 콘솔의 `SUPABASE_*` 변수와 Supabase 프로젝트는 **2026-12-01까지 그대로 둔다**(되돌리기용).
   - `--photos` 이관 후에 되돌리면 S3 버킷을 비우고 그 사실(일시·건수·작업자)을 기록한다.
10. **같은 날**:
    - 개인정보처리방침 새 버전 게시 — 관리자 법적 문서 기능으로 `docs/01-plan/features/bara-edu-lms.legal-privacy.md`의 갱신본(제5조 위탁·국외이전, 시행일 2026-11-24)을 올린다(`supabase/seed.sql`은 고치지 않는다).
    - 운영자 접근 기록 작성: 이관·psql 작업마다 누가·언제·무엇을(대상 DB, 실행 명령 종류, 조회/변경 범위).
11. **2026-12-01**:
    - Supabase 프로젝트의 데이터와 Storage 삭제, 삭제 기록(일시·범위·작업자) 작성.
    - Supabase `service_role` 키와 DB 비밀번호 교체 또는 폐기(과거 빌드 산출물에 들어 있었다).
    - Amplify 콘솔의 `SUPABASE_*`·`NEXT_PUBLIC_SUPABASE_*` 변수 삭제, 빌드 캐시 비우기.
    - (리허설 당일) 스테이징 DB와 S3 리허설 복사본은 리허설한 날 바로 삭제하고 기록한다 — 12/1까지 두지 않는다.

**전환 후 1주 안에 할 일(R24)** — 백엔드 항목 B1~B5는 2026-11-25 `feat/r24-followups`에서 구현(아직 머지·배포 전, qa-reviewer 리뷰 후 배포)

- [x] **신뢰할 클라이언트 IP(B1)**: `lib/db/client-ip.ts`의 `clientIpFrom(get)` 하나를 `lib/db/api.ts`·`proxy.ts`·`lib/supabase/admin-queries.ts`(logAdminAccess, 실제로 쓰이는 경로)가 함께 쓴다. 규칙은 운영 실측(2026-11-25, `?ipdiag=1` 로그)으로 정했다.
  - 실측: `x-forwarded-for` = `<위조 가능한 값...>, <실제 클라이언트>, <CloudFront 엣지 IP>`, `cloudfront-viewer-address` = `<클라이언트 IP>:<포트>`.
  - **"가장 오른쪽 값"은 틀렸다**(그 값은 엣지 IP). 1순위 `cloudfront-viewer-address`(마지막 `:` 뒤 포트를 자름, IPv6·대괄호 형태 포함), 2순위 `x-forwarded-for`의 **끝에서 두 번째** 값(값이 하나뿐이면 그 값, 로컬 개발), 둘 다 없으면 null. 뽑은 값이 IP 모양이 아니면 버린다. `x-real-ip`는 더 이상 쓰지 않는다.
  - `proxy.ts`의 `?ipdiag=1` 임시 진단 로그는 삭제했다.
- [x] **가입 이메일 열거 방지(B2)**: `/v1/auth/signup`은 신규·이미 인증·미인증 모두 `{status:'pending_confirmation'}`. 메일만 달라진다(신규·미인증=인증 메일, 인증 완료=`already_registered` 안내 메일 `{origin}/sign-in`). 미인증 재가입은 `/v1/auth/resend`와 같은 60초·1시간 제한, 인증 완료 계정 안내 메일도 60초 1통·1시간 4통. 탈퇴(익명화) 계정의 예전 주소는 비어 있어 새 가입으로 처리되고, 익명화 주소(`@deleted.invalid`)로 가입을 시도하면 같은 응답을 주되 메일은 보내지 않는다. 메일 제목 접두는 `[바라 평생교육원]`, 안내 메일에 문의 전화(`siteConfig.phone`)와 운영시간(`SUPPORT_HOURS`=`siteConfig.supportHours`, 값이 비면 줄 생략). 앱은 `already_registered` 분기를 없애고 문구를 `bara-edu-lms.signup-enumeration-copy.md`대로 바꿨다. 인증 전 로그인(`email_not_confirmed`)은 방법 A(별도 문구, 메일을 새로 보내지 않음).
- [x] **탈퇴 단일 트랜잭션(B3)**: `POST /v1/account/withdraw`(`{reason, detail?}`) 한 번으로 진행 중 수강 확인 → 학습 이력 파기·진단 PII 비움 → 계정 익명화 → profiles 탈퇴 → 전체 세션 삭제를 한 DB 트랜잭션에서 한다(중간 실패는 전부 롤백). 사진 삭제는 커밋 뒤, 실패는 로그만. 진행 중 수강이면 `409 conflict`(`active_enrollment`). 옛 경로(`/v1/auth/withdraw-anonymize`, `account.withdrawCleanup`, 앱의 여러 번 호출)는 삭제했다.
- [x] **세션 쿠키 슬라이딩(B4)**: `/v1/auth/session` 응답에 `expiresAt`(슬라이딩이 반영된 값)을 추가하고, `renewed`(이 요청에서 실제로 연장했는가)도 함께 준다. `proxy.ts`는 `renewed`가 true일 때만 같은 옵션(httpOnly, secure(prod), sameSite lax, path /)으로 쿠키를 다시 쓴다 — 매 요청 쓰면 공개 페이지 응답에 토큰이 실려 CDN 캐시에 섞일 수 있다(QA B-1, 개인정보 B-3). 쿠키를 쓰거나 지우는 모든 proxy 응답에는 `Cache-Control: private, no-store`를 붙이고, 503 rewrite도 같다.
- [x] **R24 추가(대표 결정, 2026-11-25)**:
  - **미인증 계정 재가입 = "마지막 가입자가 이긴다"**("선점 방지"가 아니다): 미인증 기존 계정으로 다시 가입하면 비밀번호 해시·이름·연락처를 새 값으로 덮어쓰고(`auth.users`·`profiles`), 기존 이메일 토큰(confirm·recovery)과 세션을 모두 지운 뒤 새 인증 메일을 보낸다. 60초·1시간 메일 제한에 걸리면 **덮어쓰기도 하지 않는다**(덮어쓰기·무효화·메일은 한 묶음 — 제한 중에 덮어쓰기만 하면 직전에 보낸 링크가 죽어 본인이 60초간 인증 못 하고, 무효화만 하면 링크 없이 계정이 잠긴다). 이미 인증된 계정은 덮어쓰지 않는다. 응답은 항상 같다. **한계**: 본인이 먼저 가입한 뒤 다른 사람이 같은 이메일로 재가입하면 그 사람의 비밀번호로 덮어써지고 본인에게 새 인증 메일이 간다 — 본인이 링크를 누르면 상대가 아는 비밀번호의 계정이 인증된다(이전 방식과 위험이 대칭). 덮어쓸 때마다 직전 링크가 죽어 60초마다 괴롭힐 수도 있다. **근본 해결 = 인증할 때 가입 비밀번호를 다시 확인**(대표 승인 완료, 화면 기획이 필요해 다음 배포로 연기). 이번 배포는 이 한계를 안고 간다.
  - **수강신청 순서·정원 경쟁**: 앱은 중복·모집 마감·정원 초과 사전 검사를 사진 업로드·profiles 갱신보다 먼저 하고, 최종 검증과 기록은 `POST /v1/op/enrollments.apply`가 강좌 행 `FOR UPDATE` 아래 한 트랜잭션에서 한다. 정원은 계속 **승인 건수** 기준(Q3)이라 신청(pending)은 자리를 잡지 않는다 — 동시 신청이 정원을 "넘는" 일은 정의상 없고, 정원 초과는 관리자 승인 시점에서만 생기므로 **승인 때 정원을 막는다**(대표 결정): `POST /v1/op/enrollments.approve`가 강좌 행을 잠그고 승인 인원을 세어 정원이 차면 `full`로 거절하고, 관리자 화면에는 "정원이 찼어요. 강좌 정원을 먼저 늘려 주세요."를 보여 준다. `seats`는 NOT NULL(기본 0)이라 null 정원은 없고, 정원 0은 기존대로 "마감"으로 취급해 승인도 막는다. 일괄 승인 기능은 없다(승인은 신청 1건씩). 신청 트랜잭션은 프로필을 `FOR SHARE`로 읽고 탈퇴는 프로필 행을 먼저 잠가(`FOR UPDATE`) 서로 직렬화한다.
  - **퀴즈**: `submit_quiz_attempt`가 (회원, 강의)별 advisory lock으로 `attempt_no`를 직렬화한다. 정답이 설정되지 않은 문항은 채점 대상에서 빼고(`total_questions`·`results`·`get_quiz_for_lesson` 모두 같은 규칙), 한 문항에 선택지를 둘 이상 보내면 `multiple options selected for one question`으로 거부한다.
  - **락 순서 통일**: 이메일 토큰 → 사용자(`auth.users`) → `profiles`. `verify-email`·`reset-password`가 토큰을 먼저 갱신하므로 재가입 덮어쓰기·탈퇴·비밀번호 변경도 시작할 때 그 회원의 토큰 행부터 잠근다(데드락 방지, 동시성 테스트 포함).
  - **안내 메일 상한**: `already_registered` 메일은 같은 주소에 24시간 1통(기존 60초 1통·1시간 4통도 유지). `rate_events` 보관은 25시간으로 늘렸다.
  - **사진 파기 보장**: 탈퇴 후 사진 삭제 실패 로그에 `userId`(이메일·내용 없음)를 남기고, 스케줄러가 매일 03:40 KST에 최근 7일 안에 탈퇴한 회원의 `<uid>/photo`를 다시 지운다(처리방침 5일 내 파기, 스토리지가 설정된 경우만 실행).
  - **관리자 퀴즈 화면**: "정답이 지정되지 않은 문항은 학습자에게 보이지 않아요." 안내와 정답 없는 문항 표시.
  - **503 화면**: 직접 방문 여부를 `usePathname` 대신 `useSyncExternalStore`(서버 스냅샷 고정)로 판단해 하이드레이션 불일치를 없앴다.
  - **탈퇴 사유**: API가 앱과 같은 고정 목록(`api/src/auth/withdraw-reasons.ts` = `data/account-settings.ts`, 동기화 테스트)으로 검증한다.
  - **auth 400의 `error.field`**: 가입·재전송·재설정 요청·로그인·재설정·비밀번호 변경·탈퇴의 400 응답에 문제가 된 칸(`email`, `password`, `name`, `phone`, `currentPassword`, `token`, `origin`, `reason`)을 넣는다. 새 비밀번호 칸은 `password`로 통일. 앱 `lib/form-messages.ts`의 `FIELD_MESSAGES`가 이 값을 우선으로 쓴다.
  - **운영 DB 적용(`db:migrate`를 다시 돌리지 않는다)**: 이번에 바뀐 DB 함수 2개(`public.get_quiz_for_lesson`, `public.submit_quiz_attempt`)만 담은 `api/db/patches/2026-11-25-r24.sql`을 적용한다. `create or replace function`만 들어 있어 멱등이고 데이터·테이블·정책·트리거는 건드리지 않으며 기존 grant가 유지된다(`db:migrate`는 스키마 전체를 다시 실행해 정책·트리거를 drop/create하고 데이터 갱신 문장도 다시 돈다). 적용: `psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f api/db/patches/2026-11-25-r24.sql`. 옛 스키마 DB에 적용해 두 함수가 바뀌고 권한은 그대로임을 확인했다. 패치는 `02-schema.sql`의 같은 정의와 글자까지 같아야 한다(테스트로 확인). 기존 시도 기록의 점수·번호는 바꾸지 않는다. 배포 순서는 **DB 패치 → API → 앱**(롤백은 앱 → API). 적용 전 확인용 읽기 전용 SQL:
    - 이미 겹친 `attempt_no` 확인: `select user_id, lesson_id, attempt_no, count(*) from quiz_submissions group by 1,2,3 having count(*) > 1;`
    - 정답 미설정 문항이 있는 강의: `select q.lesson_id, q.id from quiz_questions q where not exists (select 1 from quiz_options o where o.question_id = q.id and o.is_correct);` — 이런 문항은 이제 학습자에게 보이지 않고 채점에서 빠진다(관리자가 정답을 지정하면 다시 나타난다). 운영자에게 먼저 알린다.
- [ ] 오류 화면(503 등): 스펙은 `docs/02-design/features/bara-edu-lms.error-pages.md`, 구현 남음.
- [ ] ux-writer 문구 정리: 가입·재전송·메일 문구는 B2에서 반영, 나머지는 남음.
- [~] **테스트 공백(B5)**: 수강신청 액션, `lib/db/storage.ts`, 인증 액션, `/auth/confirm` 라우트, RPC 4종(`submit_quiz_attempt`·`get_quiz_for_lesson`·`claim_diagnosis`·`get_diagnosis_summary`) 테스트 추가. 강의실·시험·관리자 액션은 남음.

대표님이 미리 주셔야 하는 것: 운영 Supabase DB 접속 정보(스키마 대조·이관용), Supabase 서비스 키(사진 이관용). SES 샌드박스 해제 결과(2026-11-20 신청).

## 가입 마무리(비밀번호 재확인) 배포·롤백 (2026-11-26, `feat/signup-verify-password`)

계약: `docs/02-design/features/bara-edu-lms.signup-verify-password.api.md`. 아직 머지·배포 전(qa-reviewer·privacy-security-officer 점검 반영 후 배포).

- **배포 순서**: 패치 `api/db/patches/2026-11-25-signup-attempts.sql` -> API -> 앱. 가입이 적은 시간에 API와 앱을 연속 배포한다(API 후 앱 전에는 옛 앱의 `/auth/confirm`이 실패한다. 앱 배포 뒤 같은 링크를 다시 열면 토큰이 소모되지 않았으므로 정상 화면이 뜬다).
- **롤백 절차(QA B1)**: 옛 `verify-email`은 토큰만으로 인증하므로, API를 옛 버전으로 되돌리면 새 방식 링크로 **인증 완료 + 비밀번호 NULL** 계정이 생길 수 있다. 순서는 **앱 -> API**, 패치 SQL은 되돌리지 않는다(추가만 했다). 롤백 후 `select id, email from auth.users where email_confirmed_at is not null and encrypted_password is null;`을 점검해 해당 회원에게 관리자 재설정 메일을 보낸다. 롤백 동안 옛 정리 함수는 시도를 지우지 않으므로 시도(이름·연락처·해시)는 계정 삭제(첫 가입 후 7일)까지 남는다.
- **패치 재적용(QA B3)**: 패치 적용 뒤 API 배포 전에 옛 API가 받은 가입(비밀번호가 `auth.users`에 있고 토큰에 `attempt_id` 없음)은 이행되지 않는다. **API 배포 직후 같은 패치를 한 번 더 적용**한다(`begin; set local role bara_edu_service; <파일>; commit;`). 이행 문장이 멱등이라 두 번 적용해도 새 방식 데이터와 인증된 회원은 그대로다(테스트로 확인). 배포 전후 `select count(*) from auth.users where email_confirmed_at is null;`을 확인한다.
