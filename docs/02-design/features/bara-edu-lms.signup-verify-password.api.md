# 가입 마무리(비밀번호 재입력) — API 확정 계약

- 작성: backend-developer, 2026-11-25
- 근거: `bara-edu-lms.signup-verify-password.md` (초안 4장 + "대표 결정" 7건). 이 문서가 구현 기준이며 초안과 다른 곳은 "초안과 다른 점"에 모았다.
- 대상 독자: frontend-developer(앱 연동), qa-reviewer, privacy-security-officer

## 1. 공통

- 호출은 서버 간(앱 서버 -> API). 모든 요청에 `x-bara-service-key`, 가능하면 `x-bara-client-ip`.
- 오류 형식: `{ "error": { "code", "message", "field"?, "attemptsLeft"? } }`
  - `field`: 400 validation에서 문제 칸(기존과 같음)
  - `attemptsLeft`: 이번에 새로 생김. `403 wrong_password`에만 들어간다(숫자).
- 상태 판정 용어(`state`): `ready` / `done` / `expired` / `locked` / `invalid`.

### 1.1 가입 시도(signup attempt)

가입 요청 1건 = 시도 1건. 시도에는 비밀번호 해시, 이름, 연락처, 실패 횟수, 잠금, 만료(생성 후 7일)가 있다. 인증 링크(토큰)는 시도 하나에 묶인다.

- 미인증 계정의 `auth.users.encrypted_password`는 NULL이다. 계정 행·프로필은 첫 가입 때만 만들고, 이후 재가입은 시도만 추가한다(덮어쓰기 없음).
- 한 계정의 유효 시도는 최대 5개. 6번째가 생기면 가장 오래된 시도(와 그 링크)를 지운다.
- 실패 횟수 5회째 불일치에 그 시도를 영구 잠근다(`locked_at`). 재전송(resend)으로 풀리지 않는다.

### 1.2 state 판정 순서 (check·complete 공통)

1. 토큰이 없거나 모르는 값, 용도가 confirm이 아님 -> `invalid`
2. 계정 이메일이 `@deleted.invalid`(탈퇴) -> `invalid`
3. 계정이 이미 인증됐거나 토큰이 이미 쓰임(확정·재설정으로 무효화됨) -> `done`
4. 시도가 없음(7일 정리·옛 방식 토큰) -> `invalid`
5. 시도가 잠김(`locked_at` 있음 또는 실패 5회) -> `locked`
6. 토큰 또는 시도 만료(토큰 24시간, 시도 7일) -> `expired`
7. 그 외 -> `ready`

초안은 `locked`를 `done`보다 앞에 뒀지만, 확정되면 그 계정의 시도가 모두 지워지므로 두 상태가 겹치지 않는다. `done`을 먼저 판정해야 확정 뒤에 옛 링크가 "잠김"으로 보이지 않는다.

## 2. `GET /v1/auth/signup-link/check` (읽기 전용)

토큰은 헤더 `x-bara-signup-token`으로 보낸다(쿼리스트링이 아님 — API 접근 로그에 토큰이 남지 않게. 이 헤더는 로그에서도 가린다).

응답 200 (항상 200, 상태는 `state`)

```json
{ "state": "ready", "email": "a@b.com", "requestedAt": "ISO", "expiresAt": "ISO", "attemptsLeft": 5 }
{ "state": "done" } | { "state": "expired" } | { "state": "locked" } | { "state": "invalid" }
```

- `ready`일 때만 `email`·`requestedAt`(시도 생성 시각)·`expiresAt`(링크 만료)·`attemptsLeft`를 준다.
- 부작용 없음: 토큰 사용, 실패 횟수, 세션, 메일, 잠금 어느 것도 바꾸지 않는다. 몇 번을 불러도 같은 결과다(메일 스캐너 안전).
- 오류: 헤더가 없거나 1~200자가 아니면 400이 아니라 200 `state: invalid`(앱이 token 없음을 한 곳에서 처리). IP 제한 `signup-link-check` 60회/15분 초과 -> 429 `rate_limited`.

## 3. `POST /v1/auth/signup-link/complete` (가입 확정)

```json
{ "token": "string(1~200)", "password": "string(1~200)" }
```

`password`는 길이만 본다(앞뒤 공백 유지, 최소 8자 검사 없음).

성공 200: `{ "sessionToken": "string", "expiresAt": "ISO" }` (옛 verify-email과 같은 모양. 앱은 `writeSession`).

| HTTP | code | message | 뜻 |
|---|---|---|---|
| 400 | validation | `invalid_token` | state=invalid (토큰 없음·모름·탈퇴 계정·시도 없음) |
| 400 | validation | `요청 형식이 올바르지 않습니다.` + `field` (`token`/`password`) | 본문 형식 오류 |
| 403 | forbidden | `wrong_password` + `attemptsLeft` | 불일치, 시도 남음(`attemptsLeft` 0~4) |
| 409 | conflict | `link_locked` | 5회째 불일치이거나 이미 잠김. 이 경우 비밀번호는 비교하지 않는다 |
| 409 | conflict | `link_expired` | 만료 |
| 409 | conflict | `link_done` | 이미 확정·재설정 등으로 무효 |
| 429 | rate_limited | 기존 문구 | IP 제한 `signup-link-complete` 30회/15분. 실패 횟수는 올리지 않는다 |

처리 순서(동시성)
1. 시도 행을 잠그고(`for update`) state를 판정한다. `ready`가 아니면 위 표대로 응답하고 끝. `ready`면 실패 횟수를 1 올리고(예약) 커밋한다. 잠금 시간을 줄이려고 bcrypt 비교는 이 트랜잭션 밖에서 한다.
2. 일치 -> 한 트랜잭션에서 락 순서(토큰 -> 시도 -> 사용자 -> profiles)대로 잠그고 여전히 미인증·시도 존재인지 다시 확인한 뒤 확정: `encrypted_password`·`raw_user_meta_data`·`email_confirmed_at`, `profiles.name/phone`을 그 시도의 값으로 설정, 그 계정의 모든 시도 삭제 + 모든 confirm 토큰 무효화, 세션 발급(같은 트랜잭션). 동시에 두 요청이 오면 먼저 끝난 쪽이 이기고 나중 쪽은 409 `link_done`.
3. 불일치 -> 5회째(예약 후 횟수가 5)면 시도를 잠그고 409 `link_locked`, 아니면 403 `wrong_password` + `attemptsLeft = 5 - 횟수`.
- 5번째 시도에 올바른 비밀번호를 넣으면 성공한다(잠금은 "5회째 불일치"에서 걸린다).
- 정답과 오답이 동시에 와도 총 비교 횟수는 5회를 넘지 않는다(예약이 행 잠금 아래에서 직렬화됨).
- 모르는 토큰과 비밀번호가 틀린 경우는 응답 코드가 다르지만(400/403), 토큰은 256비트 난수라 추측할 수 없다. 시도 번호·회원 존재는 어느 응답에도 나오지 않는다.

## 4. 기존 API 변화

| API | 변화 |
|---|---|
| `POST /v1/auth/signup` | 요청·응답 변화 없음(항상 `200 {status:"pending_confirmation"}`). 신규: 비밀번호 없는 계정 행(프로필은 트리거가 이름·연락처로 생성) + 시도 + 링크. 미인증 기존: 시도와 링크만 추가(`resend-60s`/`resend-1h` 한도 유지, 걸리면 아무것도 바꾸지 않음). 인증 완료 기존: 변화 없음(안내 메일, 24시간 1통 상한 유지) |
| `POST /v1/auth/resend` | 변화 없음(항상 200). 가장 최근의 "잠기지 않은 유효 시도"에 새 링크를 발급한다. 시도가 없으면 메일 없이 같은 200 |
| `POST /v1/auth/verify-email` | **삭제**. 호출하면 404 `not_found`(경로 없음) |
| `POST /v1/auth/login` | 응답 변화 없음. 미인증 계정은 유효 시도들의 비밀번호와 비교해 하나라도 맞으면 401 `email_not_confirmed`, 아니면 401 `invalid_credentials`(비밀번호 칸이 NULL이어도 `password_reset_required`가 나오지 않는다) |
| `POST /v1/auth/reset-password` | 링크를 쓰면 `email_confirmed_at`도 채우고(이미 그랬음), 그 계정의 시도를 모두 지우고 confirm 링크를 모두 무효화한다 |
| `POST /v1/admin/users/:id/confirm-email` | 미인증이고 비밀번호가 없는 계정 -> **409 `conflict` / `password_not_set`**. 이미 인증된 계정은 이전처럼 200(멱등). 없는 회원 404 |
| `POST /v1/account/withdraw` | 변화 없음(그 계정의 시도를 함께 삭제) |
| 정리 작업 `purge_unverified_signups` | 7일 지난 시도를 함께 삭제. 미인증 계정 7일 정리와 같은 시각(03:00 KST)에 돈다 |

## 5. 배포 순서와 호환성

1. 운영 DB 패치 `api/db/patches/2026-11-xx-signup-attempts.sql`(테이블·컬럼·함수 교체 + 기존 미인증 계정 비밀번호 비우기·옛 링크 폐기). 옛 API와도 호환된다(새 테이블·nullable 컬럼만 추가). 운영 미인증 계정은 0건(2026-11-25 확인).
2. API. 이 시점부터 `verify-email`이 404다.
   - **API 배포 직후 같은 패치를 한 번 더 적용한다**(QA B3). 패치 적용 뒤 API 교체 전까지 옛 API가 받은 가입은 비밀번호가 `auth.users`에 있고 토큰에 `attempt_id`가 없어, 새 API에서 링크는 `invalid`·재전송은 메일 없음이 된다. 패치의 이행 문장(미인증 계정 비밀번호 비우기, 옛 미사용 confirm 토큰 삭제)이 멱등이므로 두 번 적용해도 안전하고, 새 방식의 시도·토큰·인증된 회원은 건드리지 않는다(`patch-signup-attempts.test.ts`가 확인). 이행된 사람은 다시 가입하면 된다.
   - 배포 전후 `select count(*) from auth.users where email_confirmed_at is null;`을 확인한다.
3. 앱(가입 마무리 화면). 앱이 API보다 먼저 나가면 `check`가 없어 화면이 열리지 않는다.

- 2~3 사이: 옛 앱의 `/auth/confirm` 라우트가 verify-email을 부르다 실패해 `/sign-in?confirmError=1`로 간다. 이 구간은 짧아야 한다(가입 트래픽이 적은 시간에 연속 배포).
- 옛 방식으로 보낸 링크(배포 전 발송)는 시도가 없으므로 `invalid` 화면으로 간다.
- 롤백(QA B1 반영, 2026-11-26): 이전 초안의 "옛 API는 비밀번호 없는 계정을 인증할 수 없다"는 **틀린 설명**이다. 옛 `verifyEmail`은 토큰 해시만으로 토큰을 소모하고 `email_confirmed_at`을 채우므로, 새 방식의 토큰(`attempt_id` 있음)도 그대로 받는다. API만 되돌리면 메일 링크(또는 메일 보안 스캐너의 선클릭)로 **"인증 완료 + 비밀번호 NULL"** 계정이 생기고, 그 계정은 로그인이 `password_reset_required`이며 다시 가입해도 인증 계정이라 안내 메일만 간다. 복구는 비밀번호 재설정뿐이다.
  - 롤백 순서: **앱 -> API**(앱을 먼저 옛 버전으로). 앱만 되돌리면 새 API에서 가입 확정이 안 되므로 앱 단독 롤백은 의미가 없고, API를 되돌린다면 앱도 함께 되돌린다.
  - **패치 SQL은 되돌리지 않는다.** 추가만 했으므로 안전하다. 단 옛 정리 함수가 아니라 패치의 새 함수가 남아 있으면 만료 시도도 정리된다. 옛 함수로 되돌리면 롤백 기간에는 시도(이름·연락처·해시)가 계정 삭제(첫 가입 후 7일)까지 남는다 — 기록해 둔다.
  - 롤백 후 점검(읽기 전용): `select id, email from auth.users where email_confirmed_at is not null and encrypted_password is null;` 에 나오는 회원에게 관리자 재설정 메일을 보낸다(링크를 쓰면 비밀번호가 생긴다).
  - 롤백 구간에 가입한 미인증 계정은 옛 방식이라 비밀번호가 `auth.users`에 있다. 다시 배포할 때는 아래 "패치 재적용"으로 이행한다.

## 6. 초안과 다른 점

| 초안 | 확정 | 이유 |
|---|---|---|
| check는 POST 본문 | GET + 헤더 `x-bara-signup-token` | 대표 지시(읽기 전용 GET). 토큰이 URL(접근 로그)에 남지 않도록 쿼리가 아닌 헤더 |
| check 토큰 오류는 400 | 항상 200 `invalid` | 앱 분기를 한 곳으로 모으기 위해 |
| `attemptsLeft`는 추가 필드 또는 재조회 | `error.attemptsLeft`로 직접 제공 | `sendError`에 추가 필드를 허용하도록 확장 |
| state 판정에서 `locked`가 `done`보다 앞 | `done`이 앞 | 1.2절 |
| 시도 만료 7일 정리를 요청 시점에 | 정리 작업(`purge_unverified_signups`)에 포함 | 이름·연락처·해시를 보관하는 기간을 요청 유무와 무관하게 지키려고 |
| 확정 후 시도·토큰 삭제 | 시도는 삭제, 토큰은 남기되 사용 처리(`attempt_id`는 NULL) | 옛 링크를 `invalid`가 아닌 `done`으로 보여 주려고 |
