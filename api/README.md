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

DATABASE_URL=... BARA_SERVICE_KEY=... npm start   # 서버 실행 (기본 127.0.0.1:3100, 아래 환경변수 표)
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

## 운영 데이터 이관(Supabase → 새 DB, 1회)

`scripts/migrate-from-supabase.ts`. 접속 주소는 값이 아니라 **환경변수 이름**으로 넘긴다(명령 기록에 주소가 남지 않게).

**WAS의 운영 API 배포 디렉터리 안에서 실행하지 않는다.** `npm ci`와 빌드(`dist/` 덮어쓰기)를 하므로, 별도 체크아웃·디렉터리(예: 같은 커밋을 다른 경로에 clone)에서 `npm ci` 후 실행한다.

접속 주소·키는 `export VAR=<값>`처럼 명령줄에 값을 쓰지 않는다(셸 기록·`ps`에 남는다). `read -s`로 입력하거나, 0600 파일에 적어 `source`한 뒤 끝나면 파일을 지운다.

```
# 대상: 새 DB에 db:bootstrap → db:migrate까지 끝낸 상태(회원·데이터 0건). 대상 URL은 마스터(관리자) 계정이어야 한다
# 방법 1: 입력해서 넣기(화면·기록에 남지 않음)
read -rs SUPABASE_DB_URL && export SUPABASE_DB_URL         # 원본(운영 Supabase, 읽기 전용 트랜잭션으로만 읽음)
read -rs TARGET_DB_ADMIN_URL && export TARGET_DB_ADMIN_URL # 대상
npm run migrate:supabase -- --source SUPABASE_DB_URL --target TARGET_DB_ADMIN_URL

# 방법 2: 0600 파일을 source(편집기로 값을 적는다. echo/cat <<로 쓰지 않는다)
umask 077 && touch ~/migrate.env && chmod 600 ~/migrate.env
#   ~/migrate.env 내용: SUPABASE_DB_URL=... / TARGET_DB_ADMIN_URL=... / (사진) SUPABASE_URL=https://<project>.supabase.co, SUPABASE_SERVICE_ROLE_KEY=..., S3_BUCKET=..., AWS_REGION=ap-northeast-2
set -a && . ~/migrate.env && set +a

# 사진까지(member-photos → S3, 같은 키)
npm run migrate:supabase -- --source SUPABASE_DB_URL --target TARGET_DB_ADMIN_URL --photos

# 끝나면 파일과 셸 변수를 지운다
rm -f ~/migrate.env && unset SUPABASE_DB_URL TARGET_DB_ADMIN_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
```

- 원본은 `repeatable read read only` 한 트랜잭션(한 시점 스냅샷)으로 읽는다. 대상은 한 트랜잭션으로 적재하고, 검증까지 통과해야 커밋한다. 실패하면 대상은 롤백돼 빈 상태로 남는다(사진은 S3에 일부 올라갔을 수 있으나 같은 키로 덮어쓰므로 재실행해도 된다).
- 원본·대상이 같은 호스트·포트·DB이거나 대상에 회원·데이터가 한 건이라도 있으면 시작하지 않는다(마이그레이션이 넣는 `diagnosis_course_links` 기본 4행은 예외 — 원본 값으로 바꾼다). `--force` 없음, 리허설은 새 DB에서.
- 복사 범위: `auth.users`의 `id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data`와 `public`의 모든 테이블(FK 순서). 세션·메일 토큰은 옮기지 않는다(전환 후 다시 로그인).
- 대상에서 `session_replication_role = replica`로 트리거(profiles 자동 생성, 권한 열 보호 등)와 FK 트리거를 끄고 적재한다. 그래서 적재 후 모든 FK를 직접 검사해 끊긴 행이 있으면 실패한다.
- 대상 접속 계정은 RDS 마스터(`session_replication_role` 설정 권한 + bootstrap이 준 `bara_edu_service` SET 권한)여야 한다. 스크립트는 `session_replication_role`을 먼저 설정한 뒤 `set local role bara_edu_service`(테이블 소유자라 RLS 미적용)와 `row_security = off`로 바꿔 빈 대상 확인·적재를 한다. 원본도 `row_security = off`라 정책이 행을 숨기면 건수 누락 대신 오류로 멈춘다.
- 사진 키(`photo_path`)는 API 규칙(`<uuid>/<[A-Za-z0-9._-]{1,100}>`, 점만 있는 부분 금지)에 맞아야 한다. `--photos`일 때 하나라도 어긋나면 다운로드 전에 실패한다(키가 서비스 키를 담은 URL에 들어가므로). `--photos` 없이도 건수는 출력한다.
- 실패 시 마지막 줄이 대상 상태다: `target rolled back` / `target not committed (...)` / `target commit status unknown: ...`(커밋 중 연결 끊김 — 재실행 전 대상이 비었는지 확인) / 성공 시 `migration done`.
- 원본에 대상에 없는 테이블·열이 있으면 시작하지 않는다(데이터 유실 방지). 대상에만 있는 열은 기본값으로 둔다(목록 출력).
- TLS: pg는 `sslmode=require`를 `verify-full`로 다룬다. Supabase pooler는 Supabase 자체 CA라 원본 URL에 `sslmode=verify-full&sslrootcert=<Supabase CA 인증서 경로>`(대시보드 Database Settings에서 내려받음)를, RDS 대상에는 `sslrootcert=<RDS global-bundle.pem 경로>`를 붙인다.
- 출력은 건수·테이블 이름만: 비밀번호 해시 접두어별 건수(`$2a$`/`$2b$`/기타, 기타는 로그인 때 `password_reset_required`), 미인증 건수, 원본 `auth.users`의 `deleted_at`·`banned_until`·이메일 없음·`is_anonymous` 건수(열이 없으면 `n/a`, 복사 방식은 같음), 사진 키 건수, 테이블별 원본·대상 건수, 주요 테이블 `id` 체크섬 일치 여부, 시퀀스 재설정 수, 사진 건수. 하나라도 다르면 exit 1.

## 환경변수

| 이름 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `DATABASE_URL` | O | - | `bara_edu_app` 역할로 접속하는 PostgreSQL URL. 운영은 `sslmode=verify-full&sslrootcert=<RDS global-bundle.pem>` |
| `BARA_SERVICE_KEY_PARAM` | | - | 있으면 시작할 때 SSM Parameter Store에서 이 이름의 값을 `WithDecryption`으로 읽어 서비스 키로 쓴다(인스턴스 역할, 운영 `/bara-edu/api/service-key`). 읽기 실패·32바이트 미만이면 시작 거절. 값은 로그에 남지 않는다 |
| `BARA_SERVICE_KEY` | △ | - | `BARA_SERVICE_KEY_PARAM`이 없을 때(로컬) 쓰는 서비스 키. 앱 서버가 `x-bara-service-key` 헤더로 보낸다. 32바이트 이상 |
| `PORT` | | `3100` | 수신 포트(1~65535 정수) |
| `API_HOST` | | `127.0.0.1` | 수신 주소. 운영은 WAS 사설 IP(`0.0.0.0` 기본값은 없앴다) |
| `TLS_CERT_FILE` | 운영 O | - | 내부 인증서(PEM) 경로. `TLS_KEY_FILE`과 함께 있으면 HTTPS로만 수신. 시작 때 한 번 읽는다 |
| `TLS_KEY_FILE` | 운영 O | - | 위 인증서의 개인키(PEM) 경로. 둘 중 하나만 있으면 시작 거절 |
| `BARA_ALLOW_PLAINTEXT` | | - | `NODE_ENV=production`에서 TLS 없이 시작하려면 `1`(경고 로그 고정 문구). 그 외 값은 무시 |
| `NODE_ENV` | | - | `production`이면 `MAIL_FROM`·`S3_BUCKET`·`AWS_REGION`이 모두 있어야 하고, `BARA_DEV_FAKES`가 있으면(값 무관), TLS가 없으면(`BARA_ALLOW_PLAINTEXT=1` 제외) 시작 거절 |
| `SESSION_TTL_DAYS` | | `30` | 세션 유효 일수(1~3650 정수) |
| `SITE_ORIGINS` | | `https://bara-edu.kr` | 메일 링크에 허용하는 사이트 주소(쉼표 구분) |
| `MAIL_FROM` | 운영 O | - | 있으면 SES(`AWS_REGION`)로 메일 발송, 발신 예: `바라평생교육원 <no-reply@bara-edu.kr>`. 없으면 메일 발송은 실패로 로그만 남는다 |
| `S3_BUCKET` | 운영 O | - | 수강신청 사진 버킷. 없으면 사진 저장·조회는 실패한다 |
| `AWS_REGION` | 운영 O | `ap-northeast-2` | SES·S3·SSM 리전 |
| `BARA_DEV_FAKES` | | - | 로컬 확인 전용. `1`이면 SES·S3 대신 메모리 구현을 쓰고 메일 링크(토큰 포함)를 로그에 남긴다. `SITE_ORIGINS`가 전부 `localhost`·`127.0.0.1`이어야 하고, `NODE_ENV=production`이거나 `MAIL_FROM`·`S3_BUCKET`이 있으면 시작을 거절한다 |
| `LOG_LEVEL` | | `info` | 로그 수준(`fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent`). 오류 로그에는 pg `detail`·쿼리 값, `x-bara-service-key`·`x-bara-session` 헤더가 남지 않는다 |
| `ADMIN_MFA_MODE` | 운영 O | 로컬 `enforce` | 관리자 2단계 인증 모드 `off`/`optional`/`enforce`. 운영에서 없거나 셋 중 하나가 아니면 시작 거절(보안 점검 I-3). 시작 로그 `event=mfa_mode`, `enforce`가 아니면 경고 `mfa_mode_weak`. 마지막으로 시작한 모드(`auth.mfa_runtime`)와 다르면 시작할 때 비밀번호만의 관리자 세션을 모두 지운다(`mfa_mode_changed`). 바꿀 때는 대표 승인 기록 |
| `ADMIN_MFA_GRACE_UNTIL` | 운영 `optional`이면 O | - | 유예 종료 시각(오프셋 있는 ISO 8601, 예 `2026-12-03T00:00:00+09:00`). 화면 배너 표시용(`/v1/auth/mfa/status`의 `graceUntil`). 자동 전환은 하지 않는다 |
| `ADMIN_SECURITY_ALERT_TO` | 권장 | - | 관리자 보안 알림을 추가로 받을 주소(쉼표, 최대 5개, 관리자 이메일과 다른 메일함). 다른 활성 관리자도 없고 이것도 없으면 본인 메일만 보내고 접속 기록에 `alert=self_only` |
| `BARA_MFA_KEY_PARAMS` | 운영 O | - | 2단계 인증 마스터 키 SSM SecureString 목록 `1=/bara-edu/api/mfa-key-v1[,2=/bara-edu/api/mfa-key-v2]`. 각 값은 base64로 정확히 32바이트(`openssl rand -base64 32`, 끝 줄바꿈 없이). 운영에서는 모드와 상관없이(off 포함) 필수. 읽기 실패·형식 오류·`auth.mfa_key_check` 불일치면 시작 거절 |
| `BARA_MFA_KEY_CURRENT` | `BARA_MFA_KEY_PARAMS`가 있으면 O | - | 새로 암호화·HMAC할 때 쓰는 키 버전(목록에 있어야 함). 옛 버전은 검증용으로 목록에 남긴다(키 교체 절차: 기획서 2.6, `mfa-rekey`) |
| `BARA_MFA_KEYS` | 로컬 전용 | - | 로컬·테스트용 평문 키 목록 `1=<base64 32바이트>,…`(현재 버전은 `BARA_MFA_KEY_CURRENT`, 없으면 가장 큰 버전). `NODE_ENV=production`에서 있으면 시작 거절. 운영이 아닌데 키가 하나도 없으면 2단계 API는 503 `unavailable` |

AWS 자격 증명은 환경변수로 넣지 않고 인스턴스 역할(기본 자격 증명 체인)을 쓴다.

스크립트 전용(서버는 읽지 않음): `DATABASE_ADMIN_URL`·`BARA_APP_DB_PASSWORD`(`db:bootstrap`/`db:migrate`), `TEST_ADMIN_URL`(테스트), 이관 스크립트의 `--source`/`--target`이 가리키는 변수와 `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`·`S3_BUCKET`·`AWS_REGION`(`--photos`).

DB 연결 풀: 연결 대기 5초 제한, 유휴 연결이 끊기면 고정 문구와 오류 코드만 로그에 남기고 계속 동작한다. `db:migrate` 후에는 API를 재시작한다(테이블·RPC 목록을 시작 후 처음 읽을 때 캐시한다).

## 공통 규칙

- `/healthz`를 뺀 모든 경로는 `x-bara-service-key`가 맞아야 한다(아니면 401 `unauthorized_service`).
- 로그인 세션은 `x-bara-session` 헤더로 보낸다.
- 앱은 사용자 IP를 `x-bara-client-ip`로 전달한다. 이 헤더 기준으로 `signup` IP당 1시간 10회, `resend`·`request-reset` 각각 IP당 1시간 20회, `login` IP당 15분 50회(초과 429 `rate_limited`). 헤더가 없거나 비어 있으면 IP 제한은 걸지 않는다(이메일 기준 제한은 그대로).
- `signup`·`resend`·`request-reset`·관리자 `send-reset`의 메일은 응답 뒤에 발송한다. 발송 실패는 로그(오류 이름만)에만 남고 응답에는 드러나지 않는다(관리자 `send-reset`의 `mailSent`는 발송 접수 의미로 항상 `true`).
- 오류 응답은 항상 `{ "error": { "code", "message" } }`. 코드: `unauthorized_service`(401), `unauthenticated`(401), `forbidden`(403), `validation`(400), `rate_limited`(429), `not_found`(404), `conflict`(409), `unavailable`(503), `internal`(500, 내부 오류 문구는 노출하지 않음). 필요하면 `error`에 `field`·`attemptsLeft`·`lockScope`·`retryAfterMinutes`·`reason` 같은 추가 필드가 붙는다.

## 경로

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/healthz` | 상태 확인(키 불필요) |
| POST | `/v1/auth/signup` | 회원가입 |
| POST | `/v1/auth/resend` | 인증 메일 재발송 |
| GET | `/v1/auth/signup-link/check` | 가입 링크 상태 조회(읽기 전용, 토큰은 헤더 `x-bara-signup-token`) |
| POST | `/v1/auth/signup-link/complete` | 가입 확정(링크 토큰 + 가입 때 비밀번호) 후 세션 발급. 옛 `verify-email`은 삭제됨 |
| POST | `/v1/auth/login` | 로그인 |
| POST | `/v1/auth/logout` | 로그아웃(세션 필요) |
| POST | `/v1/auth/logout-all` | 내 모든 세션 폐기, 현재 세션 포함(세션 필요) |
| POST | `/v1/auth/change-password` | 비밀번호 변경(세션 필요) |
| POST | `/v1/auth/request-reset` | 비밀번호 재설정 메일 요청 |
| POST | `/v1/auth/reset-password` | 비밀번호 재설정 |
| POST | `/v1/account/withdraw` | 회원 탈퇴(세션 필요, 한 트랜잭션) |
| GET | `/v1/auth/session` | 현재 세션의 사용자·프로필(세션 필요) |
| POST | `/v1/admin/users/:id/confirm-email` | 관리자: 이메일 인증 처리 |
| POST | `/v1/admin/users/:id/send-reset` | 관리자: 재설정 메일 발송 |
| GET | `/v1/admin/users/confirmations` | 관리자: 인증 대기 목록 |
| POST | `/v1/auth/mfa/verify` | 관리자 2단계: 인증 앱 6자리(대기표) |
| POST | `/v1/auth/mfa/recover` | 관리자 2단계: 복구 코드(대기표) |
| POST | `/v1/auth/mfa/enroll/ticket` | 등록 코드 확인(입구 B) |
| POST | `/v1/auth/mfa/enroll/start` | 등록 시작(입구 A·B·C) |
| POST | `/v1/auth/mfa/enroll/current` | 진행 중인 등록 다시 보기 |
| POST | `/v1/auth/mfa/enroll/confirm` | 등록 확정 |
| GET | `/v1/auth/mfa/status` | 내 2단계 인증 상태(관리자 세션) |
| POST | `/v1/auth/mfa/recovery-codes` | 복구 코드 재발급(6자리 재확인) |
| POST | `/v1/auth/mfa/recovery-codes/ack` | 복구 코드 보관 확인 |
| POST | `/v1/admin/users/:id/mfa-reset` | 관리자: 다른 관리자의 2단계 인증 초기화(요청자 6자리, 2단계 세션 필요) |
| GET | `/v1/admin/users/:id/mfa` | 관리자: 대상 관리자의 2단계 인증 상태 |
| GET | `/v1/admin/mfa/overview` | 관리자: 활성 관리자 전원의 상태 |
| POST | `/v1/op/:name` | 오퍼레이션 실행 |

## 관리자 2단계 인증

계약(요청·응답·오류)은 `docs/02-design/features/bara-edu-lms.admin-totp.md` 4장이 기준이다. 요약:

- 비밀번호가 맞은 관리자는 모드·계정 상태(기획서 2.2)에 따라 세션 대신 `{ mfa: "required" | "enroll_required", challengeToken, challengeExpiresAt, enrollReason? }`을 받는다. 세션은 6자리·복구 코드·등록 확정 뒤에만 생긴다.
- 관리자 세션은 최대 12시간(연장 없음) + 1시간 미사용 만료. 끝난 세션의 `GET /v1/auth/session`은 401 `{ error: { code: "unauthenticated", message: "session_expired", reason: "max" | "idle" } }`. 앱은 관리자 화면 요청에 `x-bara-activity: admin`을 붙인다(프리페치 헤더가 있으면 무시).
- TOTP는 RFC 6238(SHA-1, 6자리, 30초, ±1칸), 같은 칸 재사용은 403 `code_reused`. 비밀 키는 AES-256-GCM(AAD에 용도·사용자·키 버전), 복구 코드·등록 코드는 HMAC-SHA256만 저장. 새 의존성 없음(`node:crypto`). QR은 앱이 `otpauthUri`로 그린다.
- 시도 제한: 대기표당 5회, 계정당 15분 10회 + 24시간 30회(`mfa-fail`), IP당 15분 50회(`mfa-ip`). 응답 `Cache-Control: no-store`.
- 정리: `purge_expired_mfa_rows`(매일 03:50 KST) — 만료된 등록 대기, 만료 1일 지난 대기표, 만료·사용 1일 지난 등록 코드.

운영 명령(서버에서 개발 담당만, SSM Session Manager 접속). API와 같은 환경 변수를 읽는다. 변경 명령은 접속 기록을 같은 트랜잭션에 남기고, 기록이 실패하면 아무것도 바꾸지 않는다.

```bash
npm run build
npm run admin-mfa -- mfa-report --operator "이름"                                     # 강제 전 점검표(보안 점검 I-8)
npm run admin-mfa -- mfa-ticket --email <관리자> --operator "이름"                       # 첫 관리자·승격 계정 등록 코드(터미널에 한 번만)
npm run admin-mfa -- mfa-reset  --email <관리자> --operator "이름" --reason lost_phone   # 관리자가 한 명뿐일 때 초기화 + 등록 코드
npm run admin-mfa -- mfa-unlock --email <관리자> --operator "이름" --reason owner_locked # 잠금 해제
npm run admin-mfa -- mfa-clear  --email <강등된 계정> --operator "이름"                  # 강등 뒤 정리
npm run admin-mfa -- mfa-rekey  --operator "이름"                                       # 키 교체 3단계(API를 새 키로 먼저 재시작)
npm run admin-mfa -- admin-sessions-revoke --operator "이름"                            # 관리자 세션 전부 삭제(비상)
```

`--reason`: `mfa-reset`은 `lost_phone`/`new_phone`/`app_deleted`/`sole_admin_locked`/`key_lost`/`incident`, `mfa-unlock`은 `owner_locked`/`attack_suspected`. `--operator`는 1~50자, `;`·`=`·제어 문자 불가. 종료 코드: 0 성공, 1 실패, 2 사용법 오류. 등록 코드는 경고 문구 다음 줄에 한 번만 출력되므로 세션 기록을 끈 상태에서 실행하고 전화·대면으로만 전달한다. `MAIL_FROM`이 없으면 보안 알림 메일을 보내지 못한 수를 출력한다. `mfa-reset`·`mfa-ticket`·`mfa-rekey`는 셸의 키가 API의 키(`auth.mfa_key_check`)와 다르면 아무것도 바꾸지 않고 종료 코드 1로 멈춘다.

운영 DB 패치: `db/patches/2026-11-26-admin-mfa.sql`(`begin; set local role bara_edu_service; \i <파일>; commit;`). 순서: 앱 배포 → 패치 → API(`ADMIN_MFA_MODE=optional`, `ADMIN_MFA_GRACE_UNTIL`, 키 SSM 등록 후).

## 회원 탈퇴

`POST /v1/account/withdraw` 한 번으로 끝난다(R24). 본문 `{ "reason": "<key>", "detail": "<선택, 1000자 이하>" }`.

- 한 DB 트랜잭션에서: 진행 중 수강 확인 -> 학습 이력 파기·진단 PII 비움 -> `auth.users` 익명화(이메일 `withdrawn+<id>@deleted.invalid`, 임의 비밀번호, 메타데이터 비움, 이메일 토큰 무효화) -> `profiles` 탈퇴 처리 -> 모든 세션 삭제. 어느 단계든 실패하면 전부 롤백된다.
- 사진(`<uid>/photo`) 삭제는 커밋 뒤에 한다. 실패하면 로그만 남기고 탈퇴는 성공으로 응답한다.
- 응답: `200 { "ok": true }`, `400 validation`, `401 unauthenticated`, `409 conflict`(message `active_enrollment` — 입금 대기 또는 미수료 승인 강좌가 있음), `404 not_found`.
- 응답 후 세션은 이미 삭제되어 있다. 앱은 쿠키만 지우면 된다.

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
