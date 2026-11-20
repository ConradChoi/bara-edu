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

테스트는 실행마다 임시 데이터베이스를 만들어 스키마(`db/`)를 적용하고 끝나면 지운다.

## 환경변수

| 이름 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `DATABASE_URL` | O | - | `bara_edu_app` 역할로 접속하는 PostgreSQL URL |
| `BARA_SERVICE_KEY` | O | - | 앱 서버가 `x-bara-service-key` 헤더로 보내는 키. 32자 이상 |
| `PORT` | | `3100` | 수신 포트 |
| `SESSION_TTL_DAYS` | | `30` | 세션 유효 일수 |
| `SITE_ORIGINS` | | `https://bara-edu.kr` | 메일 링크에 허용하는 사이트 주소(쉼표 구분) |

## 공통 규칙

- `/healthz`를 뺀 모든 경로는 `x-bara-service-key`가 맞아야 한다(아니면 401 `unauthorized_service`).
- 로그인 세션은 `x-bara-session` 헤더로 보낸다.
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
     async run({ tx, userId }, params) {
       const r = await tx.query('select id, bank_name from bank_accounts order by "order", id');
       return r.rows;
     },
   });
   ```

2. `src/app.ts`의 `registerOps([...])` 목록에 추가한다. 이름이 겹치면 시작 시 throw 한다.
3. `test/ops.test.ts`를 참고해 테스트를 쓴다. SQL은 `select *` 대신 컬럼을 명시하고 정렬을 고정한다.
