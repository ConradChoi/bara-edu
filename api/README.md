# bara-edu API

Supabase를 대체하는 독립 API 서버(Fastify 5 + pg). 앱 서버만 호출하며 브라우저가 직접 부르는 경로는 없다.

## 로컬 실행·테스트

```bash
cd api
npm install
npm run db:up      # 테스트용 PostgreSQL 18 컨테이너 (localhost:54329)
npm test           # vitest 전체
npm run build      # tsc -> dist/
npm run db:down    # 컨테이너와 볼륨 삭제

DATABASE_URL=... BARA_SERVICE_KEY=... npm start   # 서버 실행 (기본 포트 3100)
```

스키마 적용(관리자 계정 `DATABASE_ADMIN_URL`로 실행, 빌드 포함):

```
DATABASE_ADMIN_URL=... BARA_APP_DB_PASSWORD=... npm run db:bootstrap   # 역할(00-roles.sql)만, 최초 1회. BARA_APP_DB_PASSWORD가 있을 때만 bara_edu_app 비밀번호를 설정
DATABASE_ADMIN_URL=... npm run db:migrate                              # 01~03, 매번 실행 가능, 역할 비밀번호는 건드리지 않음
```

로컬 통합 확인용 데이터(개발용 관리자·학습자·강좌·레슨·퀴즈·시험 문항, 운영·리허설 DB에는 쓰지 않는다):

```
DATABASE_ADMIN_URL=... npm run db:seed-dev   # 여러 번 실행해도 같은 결과. 접속 주소가 localhost가 아니거나 @dev.local 외 회원이 있으면 거절
```

테스트는 실행마다 임시 데이터베이스를 만들어 스키마(`db/`)를 적용하고 끝나면 지운다.

## 환경변수

| 이름 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `DATABASE_URL` | O | - | `bara_edu_app` 역할로 접속하는 PostgreSQL URL |
| `BARA_SERVICE_KEY` | O | - | 앱 서버가 `x-bara-service-key` 헤더로 보내는 키. 32자 이상 |
| `PORT` | | `3100` | 수신 포트(1~65535 정수) |
| `SESSION_TTL_DAYS` | | `30` | 세션 유효 일수(1~3650 정수) |
| `SITE_ORIGINS` | | `https://bara-edu.kr` | 메일 링크에 허용하는 사이트 주소(쉼표 구분) |
| `MAIL_FROM` | | - | 있으면 SES(서울 등 `AWS_REGION`)로 메일 발송, 발신 예: `바라평생교육원 <no-reply@bara-edu.kr>`. 없으면 메일 발송은 실패로 로그만 남는다 |
| `BARA_DEV_FAKES` | | - | 로컬 확인 전용. `1`이면 SES·S3 대신 메모리 구현을 쓰고 메일 링크(토큰 포함)를 로그에 남긴다. `SITE_ORIGINS`가 전부 `localhost`·`127.0.0.1`이어야 하고, `NODE_ENV=production`이거나 `MAIL_FROM`·`S3_BUCKET`이 있으면 시작을 거절한다 |
| `LOG_LEVEL` | | `info` | 로그 수준(`fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent`). 오류 로그에는 pg `detail`·쿼리 값, `x-bara-service-key`·`x-bara-session` 헤더가 남지 않는다 |

## 공통 규칙

- `/healthz`를 뺀 모든 경로는 `x-bara-service-key`가 맞아야 한다(아니면 401 `unauthorized_service`).
- 로그인 세션은 `x-bara-session` 헤더로 보낸다.
- 앱은 사용자 IP를 `x-bara-client-ip`로 전달한다. 이 헤더 기준으로 `signup` IP당 1시간 10회, `resend`·`request-reset` 각각 IP당 1시간 20회, `login` IP당 15분 50회(초과 429 `rate_limited`). 헤더가 없거나 비어 있으면 IP 제한은 걸지 않는다(이메일 기준 제한은 그대로).
- `signup`·`resend`·`request-reset`·관리자 `send-reset`의 메일은 응답 뒤에 발송한다. 발송 실패는 로그(오류 이름만)에만 남고 응답에는 드러나지 않는다(관리자 `send-reset`의 `mailSent`는 발송 접수 의미로 항상 `true`).
- 오류 응답은 항상 `{ "error": { "code", "message" } }`. 코드: `unauthorized_service`(401), `unauthenticated`(401), `forbidden`(403), `validation`(400), `rate_limited`(429), `not_found`(404), `internal`(500, 내부 오류 문구는 노출하지 않음).

## 경로

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/healthz` | 상태 확인(키 불필요) |
| POST | `/v1/auth/signup` | 회원가입 |
| POST | `/v1/auth/resend` | 인증 메일 재발송 |
| POST | `/v1/auth/verify-email` | 이메일 인증 후 세션 발급 |
| POST | `/v1/auth/login` | 로그인 |
| POST | `/v1/auth/logout` | 로그아웃(세션 필요) |
| POST | `/v1/auth/logout-all` | 내 모든 세션 폐기, 현재 세션 포함(세션 필요) |
| POST | `/v1/auth/change-password` | 비밀번호 변경(세션 필요) |
| POST | `/v1/auth/request-reset` | 비밀번호 재설정 메일 요청 |
| POST | `/v1/auth/reset-password` | 비밀번호 재설정 |
| POST | `/v1/auth/withdraw-anonymize` | 탈퇴 익명화(세션 필요, 세션은 폐기하지 않음) |
| GET | `/v1/auth/session` | 현재 세션의 사용자·프로필(세션 필요) |
| POST | `/v1/admin/users/:id/confirm-email` | 관리자: 이메일 인증 처리 |
| POST | `/v1/admin/users/:id/send-reset` | 관리자: 재설정 메일 발송 |
| GET | `/v1/admin/users/confirmations` | 관리자: 인증 대기 목록 |
| POST | `/v1/op/:name` | 오퍼레이션 실행 |

## 회원 탈퇴 순서

앱 서버는 반드시 아래 순서로 호출한다. 세션 폐기를 마지막에 해야 2단계에서 본인 권한(RLS)으로 profiles를 갱신할 수 있다.

1. `POST /v1/auth/withdraw-anonymize` — 이메일을 `withdrawn+<id>@deleted.invalid`로 바꾸고 비밀번호를 임의 값으로, 메타데이터를 비우고, 남은 이메일 토큰을 무효화한다(한 트랜잭션). 세션은 그대로 둔다.
2. 같은 세션으로 오퍼레이션/RPC를 호출해 profiles 등을 탈퇴 상태로 갱신한다.
3. `POST /v1/auth/logout-all` — 그 회원의 모든 세션(현재 세션 포함)을 폐기한다.

## 오퍼레이션

기존 `.from()`/RPC 호출을 옮기는 틀이다. 요청 `POST /v1/op/<이름>` 본문 `{ "params": {...} }` -> 성공 `200 { "data": ... }`.
없는 이름 404, params 검증 실패 400, 세션이 필요한데 없으면 401, 오퍼레이션 안의 예외는 500 `internal`.

접근 수준(`access`)

- `anon`: 세션이 있으면 그 사용자 권한(RLS 적용), 없으면 비로그인 권한으로 실행
- `user`: 세션 필수, 그 사용자 권한(RLS 적용)으로 실행
- `service`: 세션 필수, RLS를 우회하는 service 권한으로 실행. 핸들러가 `ctx.userId`로 권한을 직접 확인해야 한다(기존 service_role 사용처 전용)

### 추가 방법

1. `src/ops/<테이블 또는 도메인>.ts`에 `defineOp`으로 정의한다.
   이름은 `<테이블 또는 도메인>.<동사>`: 도메인은 소문자(`a-z0-9_`), 동사는 소문자로 시작하는 camelCase, 점은 하나(`profiles.getMine`, `bank_accounts.list`).

   ```ts
   export const bankAccountsList = defineOp({
     name: 'bank_accounts.list',
     access: 'user',
     params: z.object({}).strict(),
     async run({ tx }) {
       const r = await tx.query(
         'select id, bank_name, account_number, account_holder, "order" from bank_accounts order by "order", created_at, id',
       );
       return r.rows;
     },
   });
   ```

2. `src/app.ts`의 `registerOps([...])` 목록에 추가한다. 이름이 겹치면 시작 시 throw 한다.
3. `test/ops.test.ts`를 참고해 테스트를 쓴다. SQL은 `select *` 대신 컬럼을 명시하고 정렬을 고정한다.
