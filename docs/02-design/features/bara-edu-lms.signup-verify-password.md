# 회원가입 인증 흐름 — "가입 마무리"(비밀번호 재입력) 화면 정의서

- 작성일: 2026-11-25
- 작성: service-planner
- 근거: 대표 승인 2026-11-25 (미인증 계정 탈취 방지)
- 상태: 초안. 아래 8장의 질문에 대표 답변이 오면 확정한다. 코드는 바꾸지 않았다.
- 문구: 이 문서의 문구는 초안이다. 최종 문구는 ux-writer가 정한다. 말투 기준은 `bara-edu-lms.signup-enumeration-copy.md`(쉬운 `~해요`체, 이모지·느낌표 없음, 사용자를 탓하지 않기)를 따른다.
- 검토 필요: 개인정보(가입 시도의 이름·연락처·비밀번호 해시를 인증 전까지 보관)를 다루므로 privacy-security-officer 점검 후 배포한다. API 계약(4장)은 backend-developer가 먼저 검토한다.

## 0. 현재 구조와 취약점 (코드 확인 결과)

- `api/src/auth/service.ts` `signup()`: 미인증 계정에 같은 이메일로 다시 가입하면, 이미 있는 `auth.users` 행의 비밀번호·이름·연락처·프로필을 새 값으로 덮어쓰고 이전 토큰을 모두 무효화한 뒤 새 인증 링크를 피해자 메일로 보낸다. 링크는 "사용자(계정)"에 묶여 있고 "그 가입 시도의 비밀번호"에는 묶여 있지 않다.
- `verifyEmail()`: 토큰이 맞으면 비밀번호 확인 없이 `email_confirmed_at`을 채우고 세션을 만든다. 그래서 대표님이 설명한 4단계 공격이 성립한다.
- `app/auth/confirm/route.ts`: GET 한 번으로 토큰을 소모한다. 메일 보안 스캐너가 링크를 미리 열면 사용자가 열기 전에 토큰이 소모될 수 있다(이번 변경으로 함께 해소).
- `confirmEmailAsAdmin()`: 인증 시각만 채운다. 그 순간 행에 들어 있는 비밀번호가 곧 계정 비밀번호가 된다(3장에서 다룬다).

## 1. 핵심 설계 (한눈에)

1. 가입 시도마다 `signup_attempt`(비밀번호 해시, 이름, 연락처, 실패 횟수)를 따로 저장한다. 인증 링크(토큰)는 attempt 하나에 묶인다.
2. 미인증 계정에 다시 가입해도 기존 계정 행·프로필은 덮어쓰지 않는다. attempt만 하나 더 늘어난다. 미인증 계정의 `auth.users.encrypted_password`는 비어 있다(NULL).
3. 링크를 열면(GET) 상태만 보여 준다. 토큰은 쓰지 않는다. 비밀번호를 입력해 [가입 완료하기]를 눌러야(POST) 확정된다.
4. 비밀번호가 맞으면, 그 attempt의 비밀번호·이름·연락처로 계정이 확정되고 로그인된다. 같은 계정의 다른 attempt와 링크는 모두 무효가 된다.
5. 링크는 각자 자기 attempt의 비밀번호로만 열린다(권장안, 5.7절). 공격자의 링크는 피해자 메일함에만 가므로, 공격자는 어떤 링크도 열 수 없다.

### 1.1 전체 흐름

```mermaid
flowchart TD
  A[가입 폼 제출] --> B{이메일 상태}
  B -->|신규| C[계정 행 생성 비밀번호 없음 + attempt 생성]
  B -->|미인증 기존| D[attempt만 추가 기존 행 덮어쓰기 없음]
  B -->|인증 완료 기존| E[이미 가입된 계정 안내 메일]
  C --> F[인증 메일 발송]
  D --> F
  F --> G[메일 링크 /auth/confirm?token=]
  G --> H[GET 상태 조회만 토큰 미사용]
  H -->|ready| I[가입 마무리 화면 비밀번호 입력]
  H -->|expired/invalid| X1[링크 만료 안내 화면]
  H -->|done| X2[이미 가입 완료 안내 화면]
  H -->|locked| X3[링크 잠김 안내 화면]
  I -->|제출| J{비밀번호 확인}
  J -->|일치| K[계정 확정 + 세션 발급]
  K --> L[/my?welcome=1]
  J -->|불일치 5회 미만| M[오류 문구 남은 횟수 표시]
  M --> I
  J -->|불일치 5회째| X3
  I -->|기억나지 않아요| N[처음부터 다시 가입 또는 전화 문의]
  N --> A
```

### 1.2 시나리오 단계

정상(본인이 한 번 가입)
1. `/sign-up`에서 이메일·비밀번호·이름·연락처를 입력하고 제출한다.
2. "안내 메일을 보냈어요" 화면(기존 문구 유지, 한 줄 추가: 7.3절).
3. 메일의 [가입 마무리하기] 링크를 연다 → `/auth/confirm?token=`.
4. 화면이 이메일과 요청 시각을 보여 주고 비밀번호를 묻는다.
5. 비밀번호를 입력하고 [가입 완료하기]를 누른다.
6. 확정·로그인되어 `/my?welcome=1`로 이동한다.

공격 시나리오가 막히는 과정
1. 피해자가 가입한다 → attempt A(피해자 비밀번호)와 링크 A가 피해자 메일로 간다.
2. 공격자가 같은 이메일로 자기 비밀번호를 넣어 가입한다 → attempt B(공격자 비밀번호)가 추가되고 링크 B가 피해자 메일로 간다. 계정 행·프로필은 그대로다. 링크 A도 유효하다.
3. 피해자가 최신 메일(링크 B)을 눌러도 공격자의 비밀번호를 모르므로 열 수 없다. 이전 메일(링크 A)을 눌러 자기 비밀번호를 넣으면 계정이 확정된다.
4. 공격자는 링크를 받지 못했으므로 어떤 attempt도 확정할 수 없다. 확정 시 링크 B와 attempt B는 무효가 된다.

## 2. 화면 정의: 가입 마무리 (`/auth/confirm?token=`)

- 경로: 기존 URL을 그대로 쓴다. 이미 발송된 메일·북마크가 깨지지 않게 하기 위해서다. `app/auth/confirm/route.ts`는 삭제하고 같은 경로의 `page.tsx`로 바꾼다(`route.ts`와 `page.tsx`는 같은 경로에 공존할 수 없다). 레이아웃은 `(auth)` 그룹의 카드형(로그인·비밀번호 재설정과 동일). 구현 전 AGENTS.md 지침대로 `node_modules/next/dist/docs/`의 Server Actions·헤더 문서를 확인한다.
- 접근: 로그인 여부와 무관하다. 로그인 상태로 열면 확정 성공 때 쿠키가 새 계정으로 교체된다(5.6절).
- 응답 헤더: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`. 외부 링크·외부 스크립트를 두지 않는다(URL의 토큰이 새어 나가지 않게).
- 페이지 로드 시 하는 일: 서버에서 `signup-link/check`(4.1)를 한 번 호출한다. 읽기 전용이다. 토큰을 쓰지 않고 실패 횟수도 올리지 않는다. 쿠키도 쓰지 않는다.

### 2.1 상태별 화면

| 상태(check의 state) | 제목 | 보여 줄 것 | 버튼·링크 |
|---|---|---|---|
| `ready` | 가입을 마무리해 주세요 | 가입 이메일(전체), 요청 시각, 링크 남은 유효 시간, 입력 칸 | [가입 완료하기], "비밀번호가 기억나지 않아요" 펼치기 |
| `done` | 이미 가입을 마쳤어요 | 로그인 안내 | [로그인하기] → `/sign-in` |
| `expired` / `invalid` | 링크가 만료됐거나 올바르지 않아요 | 유효 시간(24시간) 안내, 메일 다시 받기 폼(이메일 입력) | [메일 다시 받기], [처음부터 다시 가입하기] → `/sign-up`, "이미 가입을 마쳤다면 로그인" |
| `locked` | 이 링크는 더 쓸 수 없어요 | 비밀번호를 여러 번 틀려 잠갔다는 설명 | [처음부터 다시 가입하기] → `/sign-up`, 전화 문의 |
| (로딩) | — | 서버 렌더라서 별도 스피너 없음. 제출 중에는 버튼만 로딩 | 제출 중 버튼 비활성(중복 제출 방지) |
| (API 연결 불가) | 지금 연결이 원활하지 않아요 | 기존 문구 "지금 연결이 원활하지 않아요. 잠시 후 다시 눌러 주세요" | [다시 시도] (새로고침), 전화 문의 |
| (token 파라미터 없음/형식 오류) | `invalid`와 같다 | — | — |

- `invalid`와 `expired`는 화면을 합친다. 토큰은 추측할 수 없으므로 구분해도 정보 노출은 없지만, 사용자에게는 해야 할 일이 같다.
- 탈퇴 계정의 링크는 `invalid`로 보인다(5.8절). `done`으로 보이면 사실과 다르다.
- 메일 다시 받기 폼은 기존 `ResendConfirmationForm`을 그대로 재사용한다. 성공 문구는 기존 enumeration 문서의 것을 쓴다.

### 2.2 `ready` 화면의 요소

| 요소 | 내용 | 동작·검증 |
|---|---|---|
| 제목 | 가입을 마무리해 주세요 | — |
| 안내 | 가입할 때 입력한 비밀번호를 한 번 더 입력하면 가입이 끝나요. | — |
| 정보 영역 | 이메일 `{email}` / 요청 시각 `{M월 D일 오전·오후 h시 mm분}` / `{n시간 남음}` | 읽기 전용. 이름·연락처는 보여 주지 않는다(5.4절 이유). 이메일은 가입 이메일을 그대로 보여 준다(링크를 가진 사람만 본다) |
| 숨은 칸 | 이메일을 `autocomplete="username"`으로 둔다(비밀번호 관리자 연동용) | 화면에는 정보 영역으로만 보인다 |
| 비밀번호 칸 | 라벨 "비밀번호", 보조문 "가입할 때 입력한 비밀번호", `autocomplete="current-password"` | 필수. 비어 있으면 서버 호출 없이 "비밀번호를 입력해 주세요"(칸 아래). 최대 200자. 공백을 자르지 않는다(가입 때와 같게) |
| 비밀번호 보기 | 칸 오른쪽 토글 [보기]/[숨기기] | 기본은 숨김. 시니어가 오타를 직접 확인할 수 있게 한다. 인앱 브라우저는 자동 입력이 불안정하므로 필수 요소로 본다 |
| 주 버튼 | 가입 완료하기 | 제출 중 "확인하는 중이에요"로 바뀌고 비활성. 엔터 키로도 제출된다. JS 없이도 제출되는 `<form>` Server Action으로 만든다(인앱 브라우저 대비) |
| 보조 영역 | "비밀번호가 기억나지 않아요" (접기/펼치기) | 6.2절. 불일치가 3번째일 때부터 자동으로 펼친다 |
| 안내 | 본인이 가입을 요청하지 않았다면 이 화면을 닫아 주세요. 아무것도 바뀌지 않아요. | 항상 하단에 노출 |

### 2.3 제출 결과별 동작 (`complete` 호출 후)

| 결과 | 화면 동작 |
|---|---|
| 성공 | 세션 쿠키 저장 후 `/my?welcome=1`로 이동. 비밀번호는 서버 액션에서 메모리로만 다루고 로그·URL·쿠키에 남기지 않는다 |
| 403 `wrong_password` | 같은 화면에서 칸 위에 오류와 남은 횟수 표시, 입력 칸은 비운다(보기 상태는 유지), 칸에 포커스. 3번째 불일치부터 "기억나지 않아요" 영역을 펼친다 |
| 409 `link_locked`(5번째 불일치 포함) | `locked` 화면으로 전환 |
| 409 `link_expired` | `expired` 화면으로 전환 |
| 409 `link_done` | `done` 화면으로 전환 |
| 400 `invalid_token` | `invalid` 화면으로 전환 |
| 400 `validation`(`field=password`) | 비밀번호 칸 아래에 "비밀번호를 입력해 주세요" |
| 429 | "요청이 많아요. 잠시 후 다시 시도해 주세요"(기존 429 문구). 실패 횟수는 올리지 않는다 |
| 503·네트워크 오류 | "지금 연결이 원활하지 않아요. 잠시 후 다시 눌러 주세요". 입력한 비밀번호는 유지한다 |

## 3. 관리자 "인증 처리"(`confirmEmailAsAdmin`)에 미치는 영향

### 3.1 문제

새 구조에서 미인증 계정의 `auth.users.encrypted_password`는 비어 있다(비밀번호는 attempt에만 있다). 지금의 `confirmEmailAsAdmin`은 인증 시각만 채운다. 그대로 두면 비밀번호 없는 확정 계정이 생기고 아무도 로그인하지 못한다. 반대로 관리자가 attempt 중 하나를 골라 확정하는 방식은 공격자 attempt를 확정할 위험이 있어 쓸 수 없다. 관리자는 어느 비밀번호가 본인 것인지 알 수 없다.

### 3.2 결정(권장)

| 항목 | 변경 |
|---|---|
| 관리자 콘솔 `[이메일 인증완료 처리]` 버튼 (`app/(admin)/admin/members/[id]/page.tsx` 91~99행) | 미인증 회원에게는 숨긴다(가입 마무리 전 회원은 비밀번호가 없다) |
| 대체 안내 | 미인증 회원 상세에 안내 한 줄과 기존 `[비밀번호 재설정 메일 발송]`을 앞세운다. 회원이 메일의 링크로 새 비밀번호를 정하면 인증도 함께 끝난다(`resetPassword`가 이미 `email_confirmed_at`을 채운다). 그 메일을 여는 사람은 회원 메일함의 주인뿐이다 |
| 배지 | "미인증" → "가입 마무리 전"으로 표기 변경 제안(관리자 목록·대시보드·상세. ux-writer 결정) |
| API `POST /v1/admin/users/:id/confirm-email` | 비밀번호가 없는 미인증 계정이면 409 `password_not_set`으로 거절한다. 이미 인증된 계정은 지금처럼 멱등 성공. 앱 액션 `confirmMemberEmail`은 이 경우 기존 `?error=failed` 대신 별도 안내를 쓴다(예: "비밀번호가 없는 계정은 인증 처리 대신 비밀번호 재설정 메일을 보내 주세요") |
| `resetPassword`·`sendResetAsAdmin`(미인증 계정에 사용) | 비밀번호를 정하고 인증을 마칠 때 해당 계정의 모든 attempt와 토큰을 함께 무효화한다(`invalidateEmailTokensIn`을 attempt까지 확장). `logAdminAccess` 기록은 유지 |
| 감사 로그 | `이메일 인증 수동 완료 처리` 기록은 더 이상 생기지 않는다. 재설정 메일 발송 기록(`비밀번호 재설정 메일 발송`)으로 대체된다 |

- 주의: 미인증 계정의 프로필 이름·연락처는 "처음 가입 시도" 값이다(공격자가 먼저 가입했다면 공격자 값일 수 있다). 재설정 메일로 가입을 마친 회원은 프로필 이름·연락처를 마이페이지에서 직접 확인하게 한다. 관리자는 전화로 가입 이메일만 확인하고 재설정 메일을 보낸다. 이름은 본인 확인 기준으로 쓰지 않는다(2026-11-26 정정, 대표 결정 6 참고). 마이페이지에 이름·연락처 수정이 없다면 별도 확인이 필요하다(8장 질문 6).
- 대안(비권장): 관리자 인증 처리를 유지하되 "임시 비밀번호 발급"까지 포함. 이 프로젝트에서 이미 한 번 폐기한 방식이고(`admin-members.ts` 주석) 비밀번호를 관리자가 알게 되므로 하지 않는다.

## 4. API 계약 초안 (backend-developer 검토용)

공통: 에러 형식은 기존 `{ error: { code, message, field? } }`를 따른다. `code`는 `errors.ts`의 코드(validation 400, forbidden 403, conflict 409, rate_limited 429, not_found 404), `message`는 앱이 분기하는 키(`email_not_confirmed`, `invalid_token`, `active_enrollment`와 같은 방식). 호출은 서버 간(앱 서버 → API)이고 `x-bara-client-ip`로 IP 제한을 한다. 토큰은 URL이 아닌 본문(POST)으로 보낸다(API 접근 로그에 토큰이 남지 않게).

### 4.1 `POST /v1/auth/signup-link/check` (읽기 전용, 상태 변화 없음)

요청
```json
{ "token": "string(1~200)" }
```
응답 200 (항상 200, 상태는 `state`로)
```json
{ "state": "ready", "email": "a@b.com", "requestedAt": "ISO", "expiresAt": "ISO", "attemptsLeft": 5 }
{ "state": "done" }
{ "state": "expired" }
{ "state": "locked" }
{ "state": "invalid" }
```
- `ready`일 때만 `email`·`requestedAt`·`expiresAt`·`attemptsLeft`를 준다. 다른 상태에는 개인정보를 주지 않는다.
- 판정 순서: 토큰 없음·알 수 없음 → `invalid` / 계정 이메일이 `@deleted.invalid`(탈퇴) → `invalid` / attempt 잠김 → `locked` / 계정 이미 인증됨 또는 토큰 사용됨(확정으로 무효화) → `done` / 토큰 만료 → `expired` / 그 외 `ready`.
- 오류: 400 `validation`(`field=token`)은 본문 형식 오류만. IP 제한 `signup-link-check` 60회/15분 초과 시 429 `rate_limited`.
- 부작용 금지: 토큰 `used_at`, 실패 횟수, 세션, 쿠키, 메일 어느 것도 건드리지 않는다. 메일 스캐너가 이 호출을 몇 번 해도 상태가 바뀌지 않아야 한다.

### 4.2 `POST /v1/auth/signup-link/complete` (가입 확정)

요청
```json
{ "token": "string(1~200)", "password": "string(1~200)" }
```
- `password`는 로그인과 같은 규칙으로 길이만 본다(최소 8자 검사는 하지 않는다. 가입 때 이미 검증됨). 앞뒤 공백을 자르지 않는다.

성공 200
```json
{ "sessionToken": "string", "expiresAt": "ISO" }
```
(기존 `verify-email` 응답과 같은 모양. 앱은 `writeSession`으로 쿠키를 쓴다.)

오류

| HTTP | code | message | 뜻 | 앱 동작 |
|---|---|---|---|---|
| 400 | validation | `invalid_token` | 토큰이 없거나 모르는 값, 탈퇴 계정 | `invalid` 화면 |
| 400 | validation | `INVALID`(요청 형식) + `field` (`token`·`password`) | 형식 오류 | 칸별 안내 |
| 403 | forbidden | `wrong_password` + `attemptsLeft`(숫자) | 비밀번호 불일치, 아직 시도 남음 | 남은 횟수 표시 |
| 409 | conflict | `link_locked` | 불일치 5회째이거나 이미 잠김. 비밀번호는 비교하지 않는다 | `locked` 화면 |
| 409 | conflict | `link_expired` | 만료 | `expired` 화면 |
| 409 | conflict | `link_done` | 이미 사용됨 또는 계정 이미 인증됨 | `done` 화면 |
| 429 | rate_limited | 기존 문구 | IP 제한 `signup-link-complete` 30회/15분 | 429 문구 |

- `attemptsLeft`는 기존 에러 본문에 없는 추가 필드다(`sendError`는 `field`만 지원). 추가가 부담이면 앱이 오류 직후 4.1을 다시 호출해 `attemptsLeft`를 얻는다. backend-developer가 방식을 정해 주세요.
- 5번째 불일치의 응답은 `403`이 아니라 `409 link_locked`다(화면이 곧바로 잠김 화면으로 가야 하므로).

서버 처리(순서와 동시성)
1. 토큰 해시로 토큰·attempt·계정을 조회한다. 상태(`invalid`·`locked`·`expired`·`done`)를 위 표대로 판정한다.
2. 실패 횟수를 비교 전에 원자적으로 예약한다(+1). 비밀번호가 맞으면 되돌릴 필요는 없다(확정되면 attempt가 사라지므로). 비밀번호 비교(bcrypt)는 트랜잭션 밖에서 한다(행 잠금 시간을 줄이기 위해. `login`·`withdraw`가 이미 쓰는 방식).
3. 일치하면 한 트랜잭션에서 계정 행을 `for update`로 잠그고 여전히 미인증인지 다시 확인한 뒤:
   - `auth.users`: `encrypted_password`·`raw_user_meta_data`(이름·연락처)·`email_confirmed_at`을 그 attempt의 값으로 설정
   - `public.profiles`: 이름·연락처를 attempt 값으로 설정
   - 그 계정의 모든 attempt와 모든 confirm 토큰 무효화(5.7절)
   - 세션 발급
4. 동시에 두 요청이 들어오면(더블 탭, 서로 다른 attempt) 계정 행 잠금 뒤 먼저 끝난 쪽이 이긴다. 나중 쪽은 409 `link_done`.

### 4.3 기존 API에 생기는 변화

| API | 요청·응답 모양 | 내부 동작 변화 |
|---|---|---|
| `POST /v1/auth/signup` | 변화 없음(항상 `pending_confirmation`) | 신규: 계정 행을 비밀번호 없이 만들고 attempt를 저장. 미인증 기존: 행·프로필 덮어쓰기와 `revokeAllSessions`를 하지 않고 attempt만 추가(기존 `resend-60s`/`resend-1h` 한도 유지). 한 계정의 유효 attempt는 최대 5개이며 6번째가 생기면 가장 오래된 attempt를 무효화한다. 인증 완료 기존: 변화 없음(안내 메일) |
| `POST /v1/auth/resend` | 변화 없음 | 가장 최근의 "잠기지 않은 유효 attempt"에 새 링크(토큰)를 발급한다. 같은 attempt이므로 실패 횟수는 이어진다(재전송으로 잠금을 우회하지 못한다). 해당 attempt가 없으면(모두 잠김·보관 기간 7일 경과·기존 계정 이행분) 메일을 보내지 않고 같은 성공 응답을 준다 |
| `POST /v1/auth/verify-email` | — | **삭제**. 앱의 `verifyEmail()`(lib/db/auth.ts)도 `checkSignupLink`·`completeSignup`으로 교체. 배포 순서상 옛 앱이 잠시 호출해도 비밀번호 없는 확정이 되지 않게 해야 한다(삭제하거나 `password`를 필수로) |
| `POST /v1/auth/login` | 변화 없음 | 미인증 계정은 비밀번호 칸이 비어 있다. 이 경우 유효 attempt들의 해시와 비교해 하나라도 맞으면 `email_not_confirmed`, 아니면 `invalid_credentials`를 준다(지금과 같은 결과). 해시 비교 시간은 계정 없음·인증 완료와 비슷하게 맞춘다(`dummyHash` 방식) |
| `POST /v1/auth/reset-password` | 변화 없음 | 미인증 계정이면 비밀번호 설정과 함께 모든 attempt 무효화 |
| `POST /v1/auth/change-password` | 변화 없음 | 미인증 계정은 세션이 없으므로 해당 없음 |
| `POST /v1/admin/users/:id/confirm-email` | 응답 변화: 409 `password_not_set` 추가 | 3.2절 |
| `POST /v1/account/withdraw` | 변화 없음 | 탈퇴 시 그 계정의 모든 attempt 삭제 |
| `GET /v1/admin/users/confirmations` | 변화 없음 | — |

### 4.4 데이터 제안 (확정은 backend-developer)

- 새 테이블 `auth.signup_attempts`: `id`, `user_id`, `password_hash`, `name`, `phone`, `fail_count`(기본 0), `locked_at`, `created_at`, `expires_at`(생성 후 7일).
- `auth.email_tokens`에 `attempt_id` 컬럼 추가(confirm 토큰만 사용). 토큰 유효 24시간은 그대로.
- 정리: `rate-limit.ts`처럼 요청 시점에 만료 attempt를 지운다. 이름·연락처·비밀번호 해시를 필요 기간만 보관하려는 목적이다.
- 가입한 사람의 이메일 자체는 `auth.users`에 남는다(지금과 같다).

### 4.5 앱 쪽 변화 요약 (frontend-developer)

| 파일 | 변화 |
|---|---|
| `app/auth/confirm/route.ts` | 삭제, 같은 경로의 `page.tsx`(2장)로 교체. 기존 `test/app/auth-confirm-route.test.ts`도 교체 |
| `lib/db/auth.ts` | `verifyEmail` → `checkSignupLink`·`completeSignup` |
| `app/actions/auth.ts` | 가입 마무리 Server Action 추가(성공 시 `/my?welcome=1`) |
| `components/auth/` | 가입 마무리 폼 컴포넌트 추가. 가입 폼에 "비밀번호 확인"·[보기] 추가(8장 질문 3) |
| `app/(auth)/sign-in/page.tsx` | `confirmError` 배너는 구 링크 호환으로 유지(문구는 2.1절 `expired`와 맞춤) |

## 5. 엣지케이스 표

### 5.1 비밀번호를 틀렸을 때

| 상황 | 동작 | 안내 |
|---|---|---|
| 1~2번째 불일치 | attempt `fail_count` +1, 같은 화면 유지 | "비밀번호가 맞지 않아요." + "{n}번 더 입력해 볼 수 있어요." + 확인 요령(한/영 키, Caps Lock, 가입 때 쓴 비밀번호인지) |
| 3~4번째 불일치 | 위와 같고 "기억나지 않아요" 영역을 자동으로 펼친다 | 다른 인증 메일이 있으면 그 링크로 시도하라는 한 줄 추가(5.7절) |
| 5번째 불일치 | attempt 잠금(`locked_at`). 이 attempt의 모든 링크 사용 불가 | `locked` 화면 |
| 잠긴 뒤 같은 링크 재방문 | check가 `locked`. 비밀번호는 비교하지 않는다 | `locked` 화면 |
| 잠긴 attempt의 재전송 | 메일을 보내지 않는다(같은 성공 응답, 5.7 표). 잠금 우회 방지 | `locked` 화면이 "다시 가입"을 안내 |
| 횟수 기준 | 한 attempt당 5회(링크가 여러 번 재전송되어도 합산). 시간 지나도 풀리지 않는다 | 대표 확인 필요(질문 2) |
| IP 제한 | `complete` 호출 IP당 30회/15분 초과 시 429. 이 횟수는 실패 횟수에 넣지 않는다 | 429 문구 |
| 공격자가 일부러 횟수를 소진시킬 수 있나 | 토큰(32바이트 무작위)을 알아야만 횟수가 올라간다. 토큰은 해당 이메일 메일함에만 있다. 따라서 남이 피해자의 링크를 잠글 수 없다 | — |
| 입력 실수 줄이기 | 비밀번호 보기 토글, 가입 폼의 비밀번호 확인 칸 | 질문 3 |

### 5.2 비밀번호가 기억나지 않을 때

- 위치: 가입 마무리 화면의 접이식 영역(2.2절), 잠김 화면, 만료 화면.
- 내용(초안):
  - "비밀번호가 기억나지 않으면 처음부터 다시 가입해 주세요. 새 인증 메일이 가고, 새로 정한 비밀번호로 가입을 마칠 수 있어요."
  - 버튼 [처음부터 다시 가입하기] → `/sign-up?email={email}`(이메일만 채워 준다. 이름·연락처·비밀번호는 채우지 않는다)
  - "다시 가입이 어렵다면 전화로 문의해 주세요. {siteConfig.phone}" (전화 링크는 `PhoneButton`·`tel:` 패턴 재사용. 번호는 하드코딩하지 않고 `siteConfig.phone`)
- 다시 가입하면: 1.2절 공격 시나리오처럼 새 attempt와 새 링크가 생긴다. 이전 링크도 자기 비밀번호를 기억해 열면 여전히 쓸 수 있다.
- 다시 가입이 막히는 경우: 같은 이메일 `resend-60s`(60초에 1번)·`resend-1h`(1시간에 4번) 한도에 걸리면 메일이 안 간다(이메일 열거 방지로 화면은 항상 "메일을 보냈어요"). "메일이 오지 않으면 1분 뒤 다시 해 주세요, 계속 안 오면 전화" 안내를 `/sign-up` 완료 화면의 기존 "메일이 안 올 때" 블록에서 유지한다.
- 이미 가입된(인증 완료) 이메일로 다시 가입한 경우: 기존대로 "이미 가입된 계정" 안내 메일이 간다. 이 흐름은 변경 없음.
- 전화 문의 시 운영 절차: 관리자 상세에서 `[비밀번호 재설정 메일 발송]`(3.2절). 본인 확인 방법은 운영 정책이다(질문 6).

### 5.3 링크 만료·이미 사용한 링크

| 상황 | check state | 화면 |
|---|---|---|
| 24시간 경과 | `expired` | 만료 화면. [메일 다시 받기]로 같은 attempt에 새 링크 발급(7일 안, 잠기지 않음) |
| 확정에 사용된 링크를 다시 열기 | `done` | "이미 가입을 마쳤어요" + [로그인하기] |
| 더 최신 가입 때문에 무효화된 링크 | 해당 없음. 새 구조에서는 다른 attempt를 확정해도 같은 계정의 모든 링크가 `done`이 된다 | — |
| 사용자가 가입 확정 뒤 다른 링크를 열기 | `done` | 위와 같음 |
| attempt 보관(7일) 끝나 정리됨 | `invalid`(토큰은 attempt와 함께 삭제) | 만료 화면. [메일 다시 받기]는 메일을 보내지 못하므로, 만료 화면에서 [처음부터 다시 가입하기]를 함께 앞세운다 |
| 옛 방식(배포 전) 링크 | `invalid`(6장 이행) | 만료 화면 |

### 5.4 이미 인증된 계정

| 상황 | 동작 |
|---|---|
| 링크를 열었는데 계정이 이미 인증됨(다른 링크로 확정, 관리자 재설정 등) | `done`. 비밀번호를 묻지 않고, 아무것도 바꾸지 않는다. 확정에 쓰이지 않은 토큰으로는 로그인도 시켜 주지 않는다 |
| 이미 인증된 이메일로 다시 가입 | 기존 `already_registered` 안내 메일(변경 없음) |
| `ready` 화면에 이름·연락처를 보여 주지 않는 이유 | 공격자가 입력한 임의 문구(이름 칸)가 피해자 화면에 그대로 보이는 것을 막는다. 이메일과 요청 시각만으로 "내가 한 가입인지" 판단하게 한다 |

### 5.5 메일 스캐너·링크 미리보기(GET으로 토큰 소모 금지)

- 링크를 여는 GET은 읽기 전용이다(2장, 4.1). 토큰 소모·실패 횟수·세션·쿠키 변경이 없다. 스캐너가 몇 번 열어도 사용자가 열었을 때 `ready`로 보여야 한다.
- 확정은 비밀번호를 담은 POST(Server Action)에서만 일어난다. 스캐너는 비밀번호를 모르므로 확정할 수 없다.
- 링크는 자동 로그인을 하지 않는다(과거에는 GET 한 번으로 로그인됐다).
- 검증: 같은 토큰으로 GET을 여러 번 호출한 뒤에도 `complete`가 성공해야 한다는 테스트를 qa-reviewer가 추가한다.
- 메일의 링크 문구는 "인증하기"가 아니라 "가입 마무리하기"로 바꾸는 안을 권한다(눌러도 바로 끝나지 않고 비밀번호를 묻는다는 기대를 맞추려고. 7.3절).

### 5.6 다른 브라우저·기기, 휴대폰 메일 앱 인앱 브라우저

| 상황 | 동작 |
|---|---|
| 가입은 PC, 링크는 휴대폰에서 연다 | 링크는 토큰과 비밀번호만으로 완결된다. 가입한 기기·브라우저 쿠키에 의존하지 않는다. 확정되면 그 휴대폰 브라우저가 로그인된다 |
| 메일 앱 인앱 브라우저에서 열고 확정 | 인앱 브라우저의 쿠키는 평소 쓰는 브라우저와 따로다. 확정 직후 `/my?welcome=1`의 환영 문구에 "다음에는 이메일과 방금 입력한 비밀번호로 로그인해요"를 한 줄 추가 제안 |
| 인앱 브라우저에서 자동 입력이 안 된다 | 비밀번호 보기 토글, 큰 입력 칸(기존 입력 높이 유지) |
| 인앱 브라우저에서 JS가 느리거나 제한 | `<form>` Server Action(JS 없이 제출 가능), 첫 화면은 서버 렌더 |
| 이미 다른 계정으로 로그인한 브라우저 | 확정 성공 시 쿠키가 새 계정 세션으로 바뀐다(기존 쿠키는 덮어씀). 이전 세션 토큰은 서버에서 만료 전까지 남을 수 있으므로, 쿠키가 있으면 확정 직전에 앱이 그 세션을 `logout`으로 폐기하는 것을 권장 |
| 가족 공용 기기 | 비밀번호 칸에 `autocomplete="current-password"`를 쓰되, 확정 후 비밀번호 저장 여부는 브라우저가 묻게 둔다 |

### 5.7 링크가 여러 개일 때

| 안 | 내용 | 평가 |
|---|---|---|
| A. 가장 최근 링크만 유효 | 새 가입 시도가 이전 링크·attempt를 모두 무효화 | 공격자가 몇 분마다 재가입하면 피해자의 링크를 계속 죽여 가입을 못 하게 만들 수 있다(DoS). 시니어가 헷갈려 두 번 가입한 뒤 처음 메일을 눌러도 실패한다. 구현은 단순 |
| B. 각 링크가 자기 attempt의 비밀번호로 유효 (권장) | 링크마다 자기 attempt 비밀번호로만 열린다. 확정되면 같은 계정의 모든 attempt·링크가 무효 | 공격자가 링크를 못 받으므로 안전하다. 피해자는 자기 메일 아무 때 것이든 자기 비밀번호로 확정할 수 있다. 재가입이 안전한 "기억나지 않을 때" 해법이 된다 |

권장 B의 부가 규칙
- 한 계정의 유효 attempt는 최대 5개(초과 시 가장 오래된 것 무효화). attempt 생성은 기존 한도(60초 1회, 1시간 4회)를 그대로 쓴다.
- 확정 후 같은 계정의 다른 attempt·토큰을 모두 무효화한다.
- 비밀번호가 틀린 화면에 "다른 인증 메일이 있다면 그 메일의 링크를 눌러 보세요" 한 줄을 넣는다(최신 메일이 공격자 것일 때 피해자가 길을 잃지 않도록).
- 메일 본문에 "이 링크는 이 메일을 받는 가입 요청용이에요. 비밀번호는 그 요청 때 입력한 것이에요" 같은 설명은 넣지 않는다(공격 정보를 줄 수 있고 시니어에게 복잡하다). 간단히 "가입할 때 입력한 비밀번호가 필요해요"만 넣는다(7.3절).
- 같은 비밀번호로 여러 번 가입한 경우는 어느 링크로 열어도 같은 결과다.

### 5.8 탈퇴한 계정

| 상황 | 동작 |
|---|---|
| 탈퇴 계정의 옛 링크 | 탈퇴 때 토큰·attempt가 삭제된다(4.3). 남아 있어도 이메일이 `withdrawn+<id>@deleted.invalid`이면 check는 `invalid`. `done`으로 보이지 않게 한다 |
| 탈퇴한 사람이 같은 이메일로 재가입(Q11에 따라 허용) | 원래 이메일은 비어 있으므로 새 가입으로 처리된다(신규 계정·새 attempt). 기존 `UNDELIVERABLE` 처리는 변경 없음 |
| 탈퇴 계정의 attempt가 새 가입에 섞일 위험 | 없다. attempt는 `user_id`에 묶이고 탈퇴 때 삭제된다 |

### 5.9 기타

| 상황 | 동작 |
|---|---|
| 토큰이 잘려 열림(메일 앱이 링크를 줄바꿈) | `invalid`. 만료 화면의 [메일 다시 받기]·[처음부터 다시 가입하기]로 복구. 메일 본문에도 링크를 한 줄로 두고, 링크가 안 열리면 복사해 붙이라는 한 줄 추가를 제안 |
| `complete` 중 서버 오류 | 서버는 확정 트랜잭션 전체 롤백. 화면은 연결 오류 문구와 입력 유지 |
| 확정 성공 후 응답 유실(네트워크) | 같은 링크가 `done`이 되므로 "이미 가입을 마쳤어요"가 나오고 [로그인하기]로 복구(비밀번호는 방금 입력한 것) |
| 더블 탭 | 버튼 비활성 + 서버 잠금(4.2). 두 번째는 `link_done`이지만 첫 요청이 쿠키를 이미 써서 `/my`로 이동하는 경로를 우선한다 |
| 로그인 시 미인증 계정 | 기존 enumeration 문서 방법 A 문구에 "링크를 열면 비밀번호를 한 번 더 입력해요" 한 줄 추가 |
| 시니어의 비밀번호 한/영·대문자 실수 | 5.1의 힌트 문구, 5회 허용 |

## 6. 배포 이행 (기존 미인증 계정)

- 배포 시점의 기존 미인증 계정(`email_confirmed_at is null`)은 비밀번호가 공격자 것인지 알 수 없다. 이를 attempt로 옮기면 공격 상태를 그대로 가져간다.
- 권장: 배포 때 해당 계정의 `encrypted_password`를 비우고, 모든 confirm 토큰을 무효화한다. 이미 보낸 옛 링크는 `invalid` 화면으로 가서 [메일 다시 받기]·[처음부터 다시 가입하기]를 안내한다. 이 경우 [메일 다시 받기]는 attempt가 없어 메일이 안 나가므로(4.3) 만료 화면에서 다시 가입을 먼저 안내한다.
- 사전 확인 쿼리(운영 DB에서 건수만): `select count(*) from auth.users where email_confirmed_at is null`, 그중 `updated_at > created_at`(재가입으로 덮어쓰기가 있었던 흔적) 건수. 후자는 운영 점검 대상으로 따로 본다. 이 쿼리는 서비스 기획 범위 밖이라 실행하지 않았다.
- 배포 순서: API 먼저(옛 `verify-email` 폐기 포함) → 앱. 앱이 먼저 나가면 `check`가 없어 가입 마무리가 열리지 않는다.

## 7. 문구 초안 (최종 문구는 ux-writer가 정한다)

8장 질문의 결정이 문구에 영향을 주는 곳은 `{ }`로 표시했다.

### 7.1 가입 마무리 화면

| 위치 | 초안 |
|---|---|
| 제목 | 가입을 마무리해 주세요 |
| 안내 | 가입할 때 입력한 비밀번호를 한 번 더 입력하면 가입이 끝나요. |
| 정보 | 가입 이메일 `{email}` / 가입 요청 `{11월 25일 오후 3시 10분}` / `{n}시간 안에 마쳐 주세요` |
| 칸 라벨 | 비밀번호 |
| 칸 보조 | 가입할 때 입력한 비밀번호 |
| 토글 | 보기 / 숨기기 |
| 주 버튼 | 가입 완료하기 |
| 제출 중 | 확인하는 중이에요 |
| 하단 안내 | 본인이 가입을 요청하지 않았다면 이 화면을 닫아 주세요. 아무것도 바뀌지 않아요. |
| 칸 비어 있음 | 비밀번호를 입력해 주세요 |
| 불일치 | 비밀번호가 맞지 않아요. 가입할 때 입력한 비밀번호를 다시 확인해 주세요. / `{n}`번 더 입력해 볼 수 있어요. |
| 불일치 도움말 | 한/영 키와 Caps Lock이 켜져 있는지 확인해 주세요. 다른 인증 메일이 있다면 그 메일의 링크도 눌러 보세요. |
| 접기 제목 | 비밀번호가 기억나지 않아요 |
| 접기 본문 | 처음부터 다시 가입하면 새 인증 메일을 보내 드려요. 새로 정한 비밀번호로 가입을 마칠 수 있어요. |
| 접기 버튼 | 처음부터 다시 가입하기 |
| 전화 | 다시 가입이 어렵다면 전화로 문의해 주세요. `{siteConfig.phone}` |
| 429 | 요청이 많아요. 잠시 후 다시 시도해 주세요 |
| 연결 불가 | 지금 연결이 원활하지 않아요. 잠시 후 다시 눌러 주세요 |

### 7.2 상태 화면

| 화면 | 제목 | 본문 | 버튼 |
|---|---|---|---|
| done | 이미 가입을 마쳤어요 | 이메일과 비밀번호로 로그인해 주세요. | 로그인하기 |
| expired·invalid | 링크가 만료됐거나 올바르지 않아요 | 인증 링크는 24시간 동안 쓸 수 있어요. 아래에서 메일을 다시 받거나 처음부터 가입해 주세요. | 메일 다시 받기 / 처음부터 다시 가입하기 |
| locked | 이 링크는 더 쓸 수 없어요 | 비밀번호가 여러 번 맞지 않아 이 링크를 잠갔어요. 처음부터 다시 가입하면 새 인증 메일을 보내 드려요. 전화로 문의하셔도 돼요. `{siteConfig.phone}` | 처음부터 다시 가입하기 |

### 7.3 연관 문구(변경 제안)

| 위치 | 초안 |
|---|---|
| 가입 직후 화면 본문(enumeration 문서 2장) | "가입이 처음이면 메일 안의 링크를 눌러 가입을 마칠 수 있어요. 이때 방금 입력한 비밀번호가 필요해요." (가입 여부를 숨겨야 하므로 "이미"·"다시"는 쓰지 않는다) |
| 인증 메일 본문 | 링크 안내에 "링크를 열면 가입할 때 입력한 비밀번호를 한 번 더 입력해 주세요. 링크는 24시간 동안 유효해요. 본인이 가입을 요청하지 않았다면 이 메일을 무시해 주세요." |
| 인증 메일 링크 라벨 | 가입 마무리하기 |
| 환영 배너(`/my?welcome=1`) | 한 줄 추가 "다음부터는 이메일과 방금 입력한 비밀번호로 로그인해요." |
| 관리자 미인증 배지 | 가입 마무리 전 |
| 관리자 상세 안내 | 이 회원은 아직 가입을 마무리하지 않아 비밀번호가 없어요. 비밀번호 재설정 메일을 보내면 회원이 직접 비밀번호를 정하고 가입을 마칠 수 있어요. |
| 관리자 인증 처리 거절 | 비밀번호가 없는 계정은 인증 처리를 할 수 없어요. 비밀번호 재설정 메일을 보내 주세요. |

## 8. 대표 확인이 필요한 정책

1. 여러 링크 정책: 5.7절의 B(각 링크가 자기 비밀번호로 유효, 권장)로 갈지, A(최신 링크만)로 갈지.
2. 비밀번호 틀림 5회 시 그 링크를 영구 잠그고 다시 가입하게 해도 되는지(권장). 대안은 15분 대기 후 재시도(시니어에게는 대기 상태가 헷갈릴 수 있어 비권장).
3. 가입 폼에 "비밀번호 확인" 입력 칸과 [보기] 토글을 추가해도 되는지(현재 가입 폼에는 확인 칸이 없고, 오타가 곧 잠김으로 이어지므로 이번 변경에서 사실상 필수에 가깝다).
4. 배포 시점의 기존 미인증 계정은 6장처럼 옛 링크를 모두 무효화하고 다시 가입하도록 해도 되는지(건수는 운영 DB에서 확인 필요).
5. 관리자 "인증 처리" 버튼을 미인증 회원에게는 없애고 비밀번호 재설정 메일로 대체해도 되는지(3.2절). 관리자가 비밀번호 없이 계정을 대신 확정하는 방법은 이 설계에서 제공하지 않는다.
6. 전화 문의로 비밀번호 재설정 메일을 보낼 때의 본인 확인 방법과 전화 응대 시간(`siteConfig`에 없음). 그리고 가입을 마친 회원이 프로필의 이름·연락처를 마이페이지에서 고칠 수 있는지.
7. 확정 전 가입 시도 정보(이름·연락처·비밀번호 해시)를 7일 보관하는 기간이 적절한지(privacy-security-officer와 함께 확인).

## 9. 구현 후 함께 갱신할 문서 (문서 동기화 원칙)

- `docs/01-plan/features/bara-edu-lms.flows.md` 2.1절의 가입 인증 흐름(링크 → 가입 마무리 → `/my?welcome=1`), 오류 표의 `confirmError`, 3장 관리자 회원 상세(인증 처리 버튼)
- `docs/02-design/features/bara-edu-lms.signup-enumeration-copy.md`의 2장(가입 직후 문구), 3장(메일 문구), 4장 코드 요청 3(로그인 시 미인증 화면)
- menu-features, design.md Error Handling 표, 관련 테스트(`test/app/auth-confirm-route.test.ts`, `test/lib/db/auth.test.ts`, `api/test/auth-signup.test.ts`)
- 이 문서는 개발 담당이 작업 중인 브랜치에 있으며, 위 문서들은 승인 전이라 수정하지 않았다.

## 대표 결정 (2026-11-25)

질문 7개 모두 추천안으로 확정.

1. 여러 링크: 각 링크가 자기 가입 시도의 비밀번호로 유효. 한 시도가 확정되면 같은 계정의 다른 시도·링크는 모두 무효.
2. 비밀번호 5회 불일치: 그 시도를 영구 잠금 → 다시 가입 안내(15분 대기 방식은 쓰지 않음).
3. 가입 폼에 "비밀번호 확인" 칸과 [보기] 토글 추가.
4. 배포 시점의 기존 미인증 계정: 옛 링크 모두 무효, 다시 가입. 운영 DB 확인(2026-11-25 20:58 KST, 읽기 전용) 결과 미인증 계정 0건.
5. 관리자 "인증 처리"는 미인증 회원에게 숨기고 API는 409 `password_not_set`. 대신 [비밀번호 재설정 메일 발송]을 쓰고, 재설정 링크 사용 시 인증도 함께 완료.
6. 전화 문의 본인 확인: **가입 이메일만 확인**하고 관리자가 재설정 메일을 보낸다(2026-11-26 개인정보 점검 B-1로 정정: 미인증 회원의 이름은 첫 가입 시도 값이라 확인 기준으로 쓰지 않는다. 재설정 메일은 가입 이메일로만 가므로 메일을 받은 사람이 곧 이메일 주인이다. 원래 결정은 "이메일과 이름"이었다). 응대 시간 `siteConfig.supportHours`(평일 10:00~18:00, 점심 11:30~13:00 제외). 마이페이지 이름·연락처 수정 가능 여부는 구현 때 확인해 보고.
7. 확정 전 가입 시도 정보 보관: 7일 후 삭제(미인증 계정 7일 정리 규칙과 동일). privacy-security-officer 점검 대상.

## 디자인 스펙

> 작성: ui-ux-designer / 2026-11-25 / 상태: Draft (F8 문구 검수 대기)
> 입력: 위 1~8장과 "대표 결정", `app/globals.css`의 `@theme`, `app/(auth)/layout.tsx`, `components/auth/AuthForm.tsx`, `components/auth/ResendConfirmationForm.tsx`, `app/(admin)/admin/members/[id]/page.tsx`, `bara-edu-lms.error-pages.md`의 '## 디자인 스펙'(D-1.2 아이콘, 56px 버튼, 인디고 주 버튼 결정)
> **이 절의 따옴표 문구는 7장 초안을 레이아웃 검증용으로 옮긴 것이다. 최종 문구와 어투는 ux-writer가 정한다.** 문구 길이가 바뀌면 줄 수 가정(375px에서 제목 2줄, 안내 3줄 이내)을 다시 확인한다.
> 새 디자인 토큰은 만들지 않았다. 클래스는 `@theme`의 `indigo`, `pink`, `danger`, `n-0~9`, `rounded-md/lg/pill`과 Tailwind 기본 스케일만 쓴다. 코드는 바꾸지 않았다.

### V-0. 설계 결정 요약과 기존 자산 점검

| # | 확인 사항 | 결과 | 디자인 결정 |
|---|---|---|---|
| 1 | 기존 `AuthForm`의 글씨는 13px, 입력 높이 `h-11`(44px), 주 버튼은 `bg-pink`+흰 글씨 | 시니어 기준(본문 16px 이상)에 못 미치고, 핑크 위 흰 글씨는 약 4.4:1로 AA(4.5:1) 근소 미달(error-pages D-0 #5와 같은 판단) | **가입 마무리 화면은 새 화면이므로 처음부터 큰 글씨와 인디고 주 버튼으로 만든다.** 가입 폼은 "비밀번호 확인" 칸만 추가하고 기존 칸의 크기·색은 바꾸지 않는다(이번 범위 밖). 단 가입 폼의 입력 글씨 13px는 iOS 인앱 브라우저에서 포커스 시 화면이 확대되는 16px 미만 구간이라, 비밀번호 두 칸만이라도 `text-base`(16px)로 올릴 것을 제안한다(V-1.2). 전체 폼 통일은 별도 제안(V-9) |
| 2 | 텍스트 색 대비(흰 배경 기준 대략값) | `n-9` 약 17:1, `n-8` 약 13:1, `indigo` 약 12:1, `n-7` 약 8.6:1, `n-6` 약 5:1은 통과. `n-5` 약 3.2:1, `danger` 약 3.9:1, `success` 약 3.2:1은 본문 글씨로 **쓰지 않는다** | 오류·성공 문구의 글자색은 `n-9`/`n-8`로 두고, 의미는 **아이콘 + 왼쪽 굵은 선(`border-danger`) + 문구**로 전한다(색만으로 전달하지 않음). `danger`는 아이콘·선(비텍스트 3:1 기준 통과)에만 쓴다. 기존 `ResendConfirmationForm`의 `text-success`·`text-danger`(12px)는 이 화면에서 쓰면 미달이므로 V-2.4에서 `size="lg"` 변형으로 해결 |
| 3 | `/auth/confirm`은 `app/auth/confirm/`(그룹 밖)이라 `(auth)/layout.tsx`(헤더·푸터·카드 폭)를 못 받는다 | 새 `page.tsx`를 같은 경로에 두면 레이아웃이 달라진다 | `page.tsx`를 **`app/(auth)/auth/confirm/page.tsx`로 둔다**(라우트 그룹은 URL에 안 나타나므로 URL은 `/auth/confirm` 그대로). 이러면 `AppHeader`·`Footer`·`max-w-[440px]`가 자동 적용된다. 구현 전 `node_modules/next/dist/docs/`에서 같은 경로 충돌 규칙 확인(정의서 2장) |
| 4 | 인앱 브라우저(메일 앱) | `position: fixed`/`sticky` 하단 버튼은 키보드가 올라오면 가려지거나 튀는 일이 잦고, JS가 늦게 올 수 있다 | **하단 고정 버튼을 쓰지 않는다.** 버튼은 폼 끝에 일반 흐름으로 둔다. 접기 영역은 JS 없이 동작하는 `<details>`를 쓴다. 높이는 `min-h-screen` 그대로(`dvh` 새 의존 없음) |
| 5 | 핵심 행동 | 가입 폼 = 가입하기, 가입 마무리 `ready` = 가입 완료하기, `done` = 로그인하기, `expired/invalid` = 메일 다시 받기, `locked` = 처음부터 다시 가입하기, 관리자 상세 = 비밀번호 재설정 메일 발송 | 화면마다 **채운(fill) 주 버튼은 1개**만 둔다. 나머지는 윤곽선(outline) 버튼 또는 텍스트 링크 |

공통 클래스(아래에서 이름으로 부른다)

| 이름 | 클래스 |
|---|---|
| `focus-ring` | `focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-indigo` (error-pages D-1.3과 같음) |
| `field-label` | `text-base font-semibold text-n-9` |
| `field-hint` | `text-sm leading-[1.6] text-n-6` (모바일 14px. 5:1이라 통과. 핵심 정보에는 쓰지 않는다) |
| `input-lg` | `h-14 w-full rounded-md border border-n-5 bg-n-0 px-4 text-base text-n-9 outline-none placeholder:text-n-6 focus:border-indigo focus:ring-2 focus:ring-indigo aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger` (높이 56px, 글씨 16px, 테두리 `n-5` 약 3.2:1로 비텍스트 3:1 통과) |
| `btn-primary` | `inline-flex h-14 w-full items-center justify-center rounded-pill bg-indigo px-6 text-lg font-bold text-n-0 hover:bg-arc-1 disabled:opacity-60 disabled:cursor-not-allowed` + `focus-ring` (56px, 인디고 위 흰 글씨 약 12:1. `hover:bg-arc-1`은 기존 토큰) |
| `btn-outline` | `inline-flex h-14 w-full items-center justify-center rounded-pill border-2 border-indigo bg-n-0 px-6 text-lg font-bold text-indigo hover:bg-n-1` + `focus-ring` |
| `notice-danger` | `flex gap-3 rounded-md border-l-4 border-danger bg-n-1 px-4 py-3 text-base leading-[1.6] text-n-9` + 앞에 `triangle-alert` 아이콘(`size-6 shrink-0 text-danger`, `aria-hidden`) |
| `notice-info` | `rounded-md bg-n-1 px-4 py-3 text-base leading-[1.6] text-n-8` |

- 기존 `border-n-3`(약 1.4:1)은 시니어에게 칸 경계가 안 보이므로 새 칸에는 쓰지 않는다.
- 버튼 문구가 길어져도 줄바꿈되도록 `h-14`는 `min-h-14`로 쓴다(`min-h-14`가 없는 Tailwind 버전이면 `min-h-[56px]`). 글씨가 커진 기기에서 잘리지 않게 한다.
- 모든 문구에 `break-keep`.

### V-1. 가입 폼 변경 (`/sign-up`, `components/auth/AuthForm.tsx` mode=signup)

**핵심 행동**: 이메일·비밀번호 등을 입력하고 [가입하기]를 누른다. 새 칸의 목적은 "오타로 잠기지 않게 하는 것"이다.

#### V-1.1 레이아웃 (모바일 375px, 데스크톱 동일 열)

세로 1열, 칸 간격 `gap-5`(기존). 순서는 이름 → 이메일 → **비밀번호 → 비밀번호 확인** → 연락처 → 약관 → 오류 → [가입하기].
- 이유: 두 비밀번호 칸이 붙어 있어야 비교가 쉽다. 연락처 앞에 둬서 "비밀번호를 정하는 일"이 한 덩어리로 끝난다.
- 모바일: 칸은 `w-full`(카드 폭 327px). 데스크톱(md~): 카드 폭은 기존 `max-w-[440px]` 유지, 칸 크기는 같다(칸을 더 넓히지 않는다. 시선 이동 최소화).

#### V-1.2 구성 요소

비밀번호 칸 구조(두 칸 공통, 새 컴포넌트 `PasswordField`로 `Field`와 별개로 만든다. 기존 `Field`는 그대로 둔다)

```
<div className="flex flex-col gap-1.5">
  <label htmlFor="password" className="field-label">비밀번호 <span aria-hidden>*</span></label>
  <p id="password-hint" className="field-hint">8자 이상 입력하세요</p>
  <div className="relative">
    <input id="password" name="password" type={shown ? 'text' : 'password'}
           autoComplete="new-password" required aria-describedby="password-hint"
           autoCapitalize="none" autoCorrect="off" spellCheck={false}
           className="input-lg pr-[76px]" />
    <button type="button" aria-controls="password"
            aria-label={shown ? '비밀번호 숨기기' : '비밀번호 보기'}
            className="absolute right-1 top-1/2 inline-flex h-12 min-w-[60px] -translate-y-1/2
                       items-center justify-center rounded-md px-3 text-base font-semibold text-indigo
                       hover:bg-n-1 focus-ring">
      {shown ? '숨기기' : '보기'}
    </button>
  </div>
</div>
```

| 요소 | 스펙 | 이유 |
|---|---|---|
| 비밀번호 확인 칸 | `id="passwordConfirm"` `name="passwordConfirm"`, 라벨 "비밀번호 확인", 보조문 "위에 입력한 비밀번호를 한 번 더 입력하세요", `autoComplete="new-password"` | `new-password`를 쓰면 브라우저가 두 칸을 "새 비밀번호 + 확인" 쌍으로 인식한다 |
| [보기] 토글 | 두 칸 **각각** 하나씩. 칸 안쪽 오른쪽, 터치 영역 48x60px(`h-12 min-w-[60px]`), 글자 "보기"/"숨기기"(아이콘만 쓰지 않는다. 눈 아이콘은 시니어에게 의미가 안 읽힌다) | 한쪽만 눌렀을 때 다른 칸이 같이 바뀌지 않는다(예측 가능). 두 칸을 비교하려면 둘 다 누르면 된다 |
| 토글 동작 | 눌러도 **포커스는 토글에 남기고**, 입력값·커서 위치를 보존한다. 페이지를 나가거나 제출 후 다시 `password`로 되돌린다 | 제출 때 평문이 남지 않게 하기 위해 폼 제출 직전 두 칸 모두 `type=password`로 되돌린다 |
| 필수 표시 | 라벨 옆 `*`는 `aria-hidden`, 입력은 `required` | 기존과 같음 |
| 일치 안내(실시간 아님) | 확인 칸에서 **포커스가 빠질 때(blur)** 와 **제출할 때** 비교한다. 입력하는 동안에는 불일치 안내를 띄우지 않는다. 한 번 불일치 안내가 뜬 뒤에는 입력할 때마다 다시 비교해 같아지는 순간 안내를 바꾼다 | 타이핑 중에 빨간 안내가 번쩍이면 시니어가 "틀렸다"고 느껴 입력을 멈춘다. 확인 후에만 알려 준다 |
| 불일치 안내 | 칸 바로 아래 `<p id="passwordConfirm-error" className="flex gap-2 text-base leading-[1.6] text-n-9">` + 앞에 `triangle-alert` 아이콘(`size-5 mt-0.5 shrink-0 text-danger`). 문구 초안 "비밀번호가 서로 달라요. 두 칸에 같은 비밀번호를 입력해 주세요." 입력은 `aria-invalid="true"`, `aria-describedby="passwordConfirm-hint passwordConfirm-error"` | 글자색은 `n-9`, 의미는 아이콘+문구로 전달 |
| 일치 안내 | 같아졌을 때만 `<p className="flex gap-2 text-base text-n-8">` + 체크 아이콘(`size-5 text-success`, `aria-hidden`) + "비밀번호가 같아요"(초안). 불일치 안내가 한 번도 안 떴으면 일치 안내도 띄우지 않는다 | 불필요한 문구를 줄이되, 고친 사람에게는 즉각 피드백을 준다 |
| 제출 차단 | `onSubmit`에서 두 값이 다르면 `preventDefault`, 불일치 안내를 띄우고 **확인 칸으로 포커스**. 서버 액션(`signup`)도 `passwordConfirm`을 한 번 더 비교해 다르면 `{ error }` 반환(JS가 없거나 우회된 경우의 안전장치) | 서버 오류로 돌아오면 React 19 폼 리셋으로 입력이 지워질 수 있어, 흔한 실수(불일치)는 서버 왕복 없이 클라이언트에서 막는다 |
| 서버 반환 불일치 | 폼 위쪽 기존 `state.error` 자리(`<p className="text-danger text-[12.5px]">`)가 아니라, 위 불일치 안내와 같은 모양(`notice-danger`)으로 [가입하기] 바로 위에 표시. 두 칸은 빈 상태로 돌아오므로 "다시 입력해 주세요"까지 문구에 포함(ux-writer) | 12.5px `text-danger`는 대비 미달 |
| 비밀번호 저장 | 두 칸이 `new-password`이므로 제출 성공 시 브라우저가 저장을 제안할 수 있다. 막지 않는다 | 가입 마무리 때 `current-password` 자동 입력에 도움이 된다 |

가입 직후 "메일을 보냈어요" 화면은 구조 변경 없음. 정의서 7.3의 한 줄("이때 방금 입력한 비밀번호가 필요해요")만 기존 `text-[14px] text-n-7` 단락 아래에 같은 스타일로 추가한다(ux-writer가 문구 확정).

#### V-1.3 포커스·aria

- 탭 순서: 비밀번호 입력 → 비밀번호 [보기] → 확인 입력 → 확인 [보기] → 연락처. (`[보기]`가 입력 바로 뒤라 시각 순서와 같다.)
- 토글 버튼: `aria-label`이 상태에 따라 "비밀번호 보기"/"비밀번호 숨기기"(확인 칸은 "비밀번호 확인 보기/숨기기"). `aria-pressed`는 **쓰지 않는다**(라벨이 바뀌므로 겹쳐 읽힘). `aria-controls`는 해당 입력 id.
- 불일치 안내가 뜨면 확인 칸에 `aria-invalid`와 `aria-describedby`가 연결되므로, 포커스가 칸에 있을 때 스크린리더가 안내를 읽는다. blur 시점에 바뀐 안내는 `aria-live="polite"` 영역 하나(`<div aria-live="polite">` 안에 불일치/일치 `<p>` 중 하나만 렌더)로 알린다.
- 칸 `required`는 브라우저 기본 검증 말풍선이 인앱 브라우저에서 안 보일 수 있으므로 앱이 직접 안내하는 것을 보조로 둔다(기존 동작 유지, 변경 없음).

### V-2. 가입 마무리 화면 (`/auth/confirm?token=`, 신규 `page.tsx`)

**핵심 행동**: 가입할 때 입력한 비밀번호를 입력하고 [가입 완료하기]를 누른다.

#### V-2.0 공통 구조

- 배치: `AuthLayout`(헤더 + `max-w-[440px] px-6 py-10` + 푸터). 모바일은 카드 테두리 없이 흰 배경 위에 바로 배치한다(좁은 화면에서 카드 테두리는 폭만 줄인다). 데스크톱(md~)에서는 본문 영역을 `md:py-16`으로 키우고 **카드형이 필요하면 `md:rounded-xl md:border md:border-n-3 md:p-8 md:shadow-sm`** 를 붙인다. 기존 로그인 화면이 카드형이면 그 마크업과 똑같이 맞춘다(구현 전 `sign-in/page.tsx` 확인. 일관성 우선).
- 제목: `<h1 id="confirm-title" tabIndex={-1} className="text-2xl font-bold leading-[1.35] text-n-9 break-keep outline-none md:text-[28px]">`. 페이지 최상위 컨테이너는 `<section aria-labelledby="confirm-title">`(`<main>`은 `(auth)` 레이아웃/루트에서 이미 제공되는지 구현 때 확인하고 중복 시 `section`만 쓴다. error-pages D-0 #6과 같은 원칙).
- 본문 글씨: 안내 `text-lg leading-[1.7] text-n-7`(18px), 정보 영역·오류 `text-base`(16px).
- 서버에서 상태를 읽어 화면을 고른다. 상태가 바뀌는 화면 전환(예: 5번째 불일치 → 잠김)은 서버 액션 응답으로 새로 렌더되며, 전환 직후 **`h1`에 포커스**를 준다(`autoFocus` 대신 `useEffect`로 `ref.focus()`, JS 없는 경우엔 페이지 새로 로드라 문서 맨 위에서 읽기 시작).
- 헤더는 기존 `AppHeader kind="public"`을 그대로 쓴다. 단, 이 화면에서는 로그인/회원가입 링크가 보이는데 가입 마무리 중 이탈 출구가 되므로 문제는 없다(오히려 [로그인] 링크가 `done` 화면의 출구가 된다).
- 외부 링크·외부 이미지·외부 폰트 없음, `Referrer-Policy: no-referrer`(정의서 2장). 이미지·일러스트 없음.

#### V-2.1 상태 ① `ready` 기본 화면

레이아웃(위에서 아래, 모두 한 열, 간격은 표기)

```
h1  가입을 마무리해 주세요                                       (mt 0)
p   가입할 때 입력한 비밀번호를 한 번 더 입력하면 가입이 끝나요.   (mt-3, text-lg text-n-7)
dl  정보 영역                                                    (mt-6)
form
  label 비밀번호 / 보조문 / [입력 + 보기]                         (mt-6)
  (오류 영역: 기본에서는 없음)
  [가입 완료하기]                                               (mt-6)
details  비밀번호가 기억나지 않아요                              (mt-8)
p   본인이 가입을 요청하지 않았다면 이 화면을 닫아 주세요 ...      (mt-8, border-t border-n-3 pt-5)
```

정보 영역(읽기 전용)
```
<dl className="rounded-lg bg-n-1 px-4 py-4 text-base leading-[1.6]">
  <div className="flex flex-col gap-0.5">
    <dt className="text-sm text-n-6">가입 이메일</dt>
    <dd className="break-all font-semibold text-n-9">{email}</dd>      /* break-all: 긴 이메일이 375px에서 넘치지 않게 */
  </div>
  <div className="mt-3 flex flex-col gap-0.5">
    <dt className="text-sm text-n-6">가입 요청</dt>
    <dd className="text-n-9">11월 25일 오후 3시 10분</dd>
  </div>
  <div className="mt-3 flex flex-col gap-0.5">
    <dt className="text-sm text-n-6">남은 시간</dt>
    <dd className="text-n-9">20시간 안에 마쳐 주세요</dd>
  </div>
</dl>
```
- 이유: 라벨(작게)·값(크게)의 세로 쌓기는 375px에서 한 줄에 라벨과 값을 같이 두는 것보다 읽기 쉽고 줄바꿈이 안정적이다. "내가 한 가입인가"를 이메일·시각으로 판단하게 하려고 `bg-n-1` 블록으로 분리한다. 이름·연락처는 보여 주지 않는다(5.4).
- 남은 시간이 1시간 미만이면 값을 "곧 만료돼요"류로 바꾸고 `font-semibold`로 강조(문구는 ux-writer). 색을 바꾸지 않는다.
- 숨은 `username` 칸: `<input type="email" name="username" autoComplete="username" defaultValue={email} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />`. 폼 안에 둔다. 화면 밖으로 빼지 않고 `sr-only`를 쓴다(`display:none`이면 비밀번호 관리자가 무시한다).

비밀번호 칸
```
<label htmlFor="confirm-password" className="field-label">비밀번호</label>
<p id="confirm-password-hint" className="field-hint">가입할 때 입력한 비밀번호</p>
<div className="relative"> <input id="confirm-password" name="password" type="password"
   autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false}
   required maxLength={200} aria-describedby="confirm-password-hint" className="input-lg pr-[76px]" />
   [보기 토글: V-1.2와 같은 스펙]
```
- 자동 포커스: **하지 않는다**(`autoFocus` 없음). 이유: 인앱 브라우저에서 페이지가 열리자마자 키보드가 올라와 제목과 정보 영역을 가리고, 스크린리더 사용자는 제목부터 듣지 못한다. 시니어가 "내가 한 가입인지" 먼저 읽을 시간이 필요하다. 단 오류 후에는 칸에 포커스(V-2.2).
- 비밀번호 칸이 비어 있으면 제출 전에 칸 아래 "비밀번호를 입력해 주세요"(`notice-danger` 한 줄 변형, 위 V-1.2 불일치 안내와 같은 모양), `aria-invalid`, 포커스는 칸. 서버 호출 없음.
- 주 버튼 `btn-primary`: "가입 완료하기". 제출 중에는 `disabled`+`aria-busy="true"`+문구 "확인하는 중이에요"(스피너 아이콘 `refresh-cw`에 `animate-spin motion-reduce:animate-none`, `aria-hidden`). 엔터 제출 가능(`<form>` 안의 단일 submit).
- "기억나지 않아요" `<details>`:

```
<details className="group mt-8 rounded-lg border border-n-3" open={attemptsLeft <= 2}>
  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 py-3
                       text-lg font-semibold text-n-9 focus-ring [&::-webkit-details-marker]:hidden">
    비밀번호가 기억나지 않아요
    <svg ... className="size-5 shrink-0 text-indigo transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />   /* chevron-down */
  </summary>
  <div className="flex flex-col gap-4 border-t border-n-3 px-4 py-4">
    <p className="text-base leading-[1.7] text-n-7">처음부터 다시 가입하면 새 인증 메일을 보내 드려요. ...</p>
    <a/Link href={`/sign-up?email=${encodeURIComponent(email)}`} className="btn-outline">처음부터 다시 가입하기</a>
    <p className="text-base leading-[1.7] text-n-7">다시 가입이 어렵다면 전화로 문의해 주세요.</p>
    <a href={`tel:${phone}`} className="btn-outline"> [phone 아이콘 size-6 mr-2] 전화 문의 {siteConfig.phone}</a>
    <p className="text-sm text-n-6">{siteConfig.supportHours}</p>
  </div>
</details>
```
- 이유: 접힌 상태가 기본이면 주 행동(입력)에 집중하고, 필요한 사람만 연다. `<details>`는 JS 없이 키보드(Enter/Space)와 스크린리더("확장됨/축소됨")가 기본 지원된다. 접이식이어도 `summary`는 56px 터치 영역.
- 전화번호는 `siteConfig.phone`(코드 상수에 하드코딩 금지, 정의서 5.2). 링크 `tel:`는 하이픈 제거 값으로 만든다. 응대 시간은 `siteConfig.supportHours`(대표 결정 6)를 `text-sm text-n-6`으로 그 아래 한 줄. 전화 버튼은 윤곽선이라 한 화면에 채운 버튼은 [가입 완료하기] 하나다.
- 하단 안내 문구: `text-base leading-[1.7] text-n-7`.

포커스·aria
- 탭 순서: (헤더 링크들) → 비밀번호 입력 → [보기] → [가입 완료하기] → 기억나지 않아요 요약 → (펼쳤을 때) 다시 가입 → 전화.
- 정보 영역은 `<dl>`이라 스크린리더가 "가입 이메일: …"로 읽는다. 포커스 불가(읽기 전용).
- 제출 중 버튼: `aria-busy`, 더블 탭 방지로 `disabled`(정의서 5.9). `disabled` 버튼은 포커스를 잃으므로 제출 후 응답 화면에서 포커스를 새로 준다(V-2.2).

#### V-2.2 상태 ② 비밀번호 틀림(남은 횟수 표시)

서버 액션이 `wrong_password`+`attemptsLeft`를 받아 같은 화면을 다시 렌더한다. 변경점만 적는다.

```
(제목·안내·정보 영역은 그대로)
[오류 박스: notice-danger, id="confirm-password-error"]                (비밀번호 칸 위, mt-6)
   비밀번호가 맞지 않아요. 가입할 때 입력한 비밀번호를 다시 확인해 주세요.
   [횟수 줄]  3번 더 입력해 볼 수 있어요.   ●●●○○   (dots 5개)
   [도움말 text-base text-n-7] 한/영 키와 Caps Lock이 켜져 있는지 ... 다른 인증 메일이 있다면 ...
[비밀번호 칸: 비움, 포커스, aria-invalid=true]
[가입 완료하기]
```

- 오류 박스를 **입력 칸 위**에 둔다. 이유: 모바일에서 키보드가 올라오면 칸 아래의 글이 가려진다. 칸 위에 있으면 포커스 이동 후에도 화면 안에 남는다. 정의서 2.3과 같다.
- 횟수 줄: 숫자를 `text-lg font-bold text-n-9`로 강조하고, 옆에 **점 5개**(`aria-hidden`, `size-3 rounded-pill`, 사용한 횟수 = `bg-n-9`, 남은 횟수 = `border-2 border-n-9 bg-n-0`). 점은 시각 보조일 뿐이고 숫자 문구가 정보 본체다(색만으로 전달하지 않음, 모양(채움/비움)도 다름). `attemptsLeft`가 1이면 문구에 "마지막이에요" 취지가 들어가도록 ux-writer에 요청하고, 박스는 같은 모양 그대로 둔다(위협적으로 보이지 않게 색·크기를 키우지 않음).
- 칸은 비우고(`defaultValue` 없음), **보기/숨기기 상태는 유지**(서버 렌더 시 `shown` 초기값을 클라이언트 상태에서 이어받는다. JS 없는 경우는 숨김으로 돌아가도 된다).
- 포커스: 렌더 직후 칸으로(`useEffect`에서 `inputRef.current?.focus()`). 칸은 `aria-invalid="true"`, `aria-describedby="confirm-password-hint confirm-password-error"`. 포커스가 칸에 가는 순간 스크린리더가 라벨 + 오류 박스를 함께 읽으므로 오류 박스에 **`role="alert"`를 달지 않는다**(이중 낭독 방지).
- 스크롤: 포커스 이동 후 오류 박스가 화면에 보이도록 `scrollIntoView({ block: 'center' })`가 아니라, 브라우저 기본 포커스 스크롤에 맡기고 박스를 칸 바로 위에 붙여(`mb-3`) 같이 보이게 한다(인앱 브라우저의 스크롤 점프 회피).

##### 3회째 불일치부터 "기억나지 않아요" 자동 펼침

- 기준: `attemptsLeft <= 2`(3번째 불일치 후 2회 남음, 4번째 후 1회 남음).
- 구현: 서버가 `<details open>`으로 렌더한다(위 `open={attemptsLeft <= 2}`). 사용자가 접었다가 다시 제출하면 서버 렌더에서 다시 열리는 것은 허용한다(필요한 도움이 계속 보이는 쪽이 낫다).
- 자동으로 열려도 **포커스는 비밀번호 칸에 둔다**(요약 줄로 이동하지 않는다). 펼침은 화면 아래쪽에서 일어나므로, 오류 박스의 도움말 끝에 "아래에서 다시 가입할 수 있어요"류 한 줄을 추가하는 것을 ux-writer에 제안한다(펼쳐진 영역의 존재를 알리기 위해).
- 펼쳐진 영역의 [처음부터 다시 가입하기]는 `btn-outline`이다. 3~4회째에도 주 행동(채운 버튼)은 [가입 완료하기] 하나로 유지한다. 이유: 아직 시도가 남아 있고, 비밀번호만 기억하면 가장 빠르기 때문이다.
- 모바일: 오류 박스(약 5줄) + 칸 + 버튼 + 펼친 영역으로 화면이 3 화면 길이쯤 된다. 일반 스크롤로 둔다(고정 영역 없음).

#### V-2.3 상태 ③ 5회째 불일치 = 잠김 (`locked`)

화면이 **상태 화면 구조**(V-2.6)로 전환된다. 입력 칸은 없다.

```
[배지 lock] / h1 이 링크는 더 쓸 수 없어요
p   비밀번호가 여러 번 맞지 않아 이 링크를 잠갔어요. 처음부터 다시 가입하면 새 인증 메일을 보내 드려요.
[btn-primary] 처음부터 다시 가입하기      → /sign-up?email={email 모르면 생략}
p   전화로 문의하셔도 돼요.
[btn-outline] 전화 문의 {siteConfig.phone}
p   text-sm text-n-6  {siteConfig.supportHours}
```
- 잠김 화면에서는 이메일을 서버가 알려 주지 않는다(`check`가 `ready` 외에는 개인정보 없음, 4.1). 따라서 `/sign-up`으로만 보낸다(`?email=` 없음). 5번째 불일치 직후 전환에서도 같다.
- 제출 직후 5번째 불일치로 막 잠겼을 때도 오류 박스는 없다. 전환 자체가 "잠겼다"는 안내이므로 문구 첫 문장이 이전 시도를 인정해야 한다("비밀번호가 여러 번 맞지 않아…" 초안).
- 주 버튼이 [처음부터 다시 가입하기]인 이유: 이 상태에서 사용자가 할 수 있는 단 하나의 복구 경로이기 때문이다(정의서 5.1). 전화는 윤곽선.
- 잠김 사유를 사용자 탓으로 읽히지 않게 하는 문구 조정은 ux-writer(error-pages C-2 어조).

#### V-2.4 상태 ④ 링크 만료 또는 이미 사용된 링크 (`expired` / `invalid`)

정의서 2.1대로 두 상태를 한 화면으로 합친다.

```
[배지 clock] / h1 링크가 만료됐거나 올바르지 않아요
p   인증 링크는 24시간 동안 쓸 수 있어요. 아래에서 메일을 다시 받거나 처음부터 가입해 주세요.
[ResendConfirmationForm size="lg"]  이메일 입력 + [메일 다시 받기](채운 주 버튼)
[btn-outline] 처음부터 다시 가입하기 → /sign-up
text-base  이미 가입을 마쳤다면 [로그인] (텍스트 링크 text-indigo underline underline-offset-4, min-h-11 inline-flex items-center)
```

- 정의서의 "이미 사용된 링크"는 `done` 상태(V-2.5)로 간다. `expired/invalid` 화면은 "이미 사용"까지 포괄하지 않는다.
- 주 버튼은 [메일 다시 받기](핵심 행동: 가장 흔한 복구). [처음부터 다시 가입하기]는 같은 크기의 윤곽선 버튼으로 **바로 아래** 둔다(정의서 5.3: 보관 기간 지난 시도는 메일이 안 나가므로 함께 앞세운다).
- **주의(사용성 문제)**: 보관 기간이 끝났거나 옛 링크인 경우 [메일 다시 받기]는 메일을 보내지 않고 같은 성공 화면을 보여 준다(열거 방지, 4.3). 사용자는 메일이 올 줄 알고 기다린다. 그래서 `ResendConfirmationForm`이 성공했을 때 보이는 문구에 "메일이 오지 않으면 처음부터 다시 가입해 주세요"가 항상 포함되어야 하고(ux-writer), 성공 후에도 [처음부터 다시 가입하기] 버튼은 화면에 남긴다(폼만 성공 문구로 바뀌고 버튼은 유지).
- `ResendConfirmationForm`은 `size?: 'md' | 'lg'` 선택 props를 추가해 확장한다(기본값 `md`는 현재 마크업 그대로. error-pages D-0 #3의 `CopyButton`과 같은 방식). `lg`일 때:

| 부분 | `md`(현재, 변경 없음) | `lg`(이 화면) |
|---|---|---|
| 입력 | `h-10 ... text-[13px] border-n-3` | `input-lg` (`h-14 text-base border-n-5`), `type="email"` `autoComplete="email"` `inputMode="email"`, 라벨 "가입한 이메일"(`field-label`, `<label htmlFor>`로 연결. 현재는 placeholder만 있어 접근성 이름이 없음) |
| 버튼 | `h-10 ... border border-n-3 text-[12.5px] text-n-7` 윤곽 작은 버튼 | `btn-primary`(채운 56px) 문구 "메일 다시 받기", 입력 아래 세로 배치(모바일·데스크톱 모두 `flex-col`. 가로 배치 `sm:flex-row`는 쓰지 않음) |
| 성공 문구 | `text-[12px] text-success` | `notice-info` + 체크 아이콘(`text-success`, `aria-hidden`), 글자 `text-n-9`. 컨테이너 `aria-live="polite"`(폼이 사라지고 문구로 바뀌어도 읽힘) |
| 오류 문구 | `text-[12px] text-danger` | `notice-danger` 한 줄, 입력에 `aria-invalid`, `aria-describedby` |

- 전환 시 포커스: 성공 문구 컨테이너에 `tabIndex={-1}` 후 `focus()`.
- 이메일 칸 `defaultValue`는 없다(`invalid` 상태는 이메일을 모른다).

#### V-2.5 상태 ⑤ 이미 인증된 계정 (`done`)

```
[배지 circle-check] / h1 이미 가입을 마쳤어요
p   이메일과 비밀번호로 로그인해 주세요.
[btn-primary] 로그인하기 → /sign-in
text-base  비밀번호가 기억나지 않으면 [비밀번호 재설정] (텍스트 링크, /reset-password 같은 기존 경로를 확인해 연결)
```
- 이유: 이 화면은 "문제가 아니라 이미 끝난 상태"이므로 배지 색을 경고로 쓰지 않는다(`bg-n-1 text-indigo` 동일). 정의서 5.9 "응답 유실로 `done`이 된 경우"의 복구 경로(방금 입력한 비밀번호로 로그인)가 주 버튼 하나로 끝나게 한다.
- 비밀번호 재설정 링크는 기존 사이트의 재설정 경로를 쓴다(`app/(auth)/reset-password`는 재설정 *실행* 화면이라, 요청 화면 경로는 `sign-in` 화면의 "비밀번호를 잊으셨나요"류 링크와 동일하게 맞춘다. 구현 때 확인).
- 로그인 상태에서 열면 헤더가 사용자 메뉴로 보일 수 있다. 화면은 같다.

#### V-2.6 상태 화면 공통 구조 (`locked`, `expired/invalid`, `done`, 연결 불가)

```
<section aria-labelledby="confirm-title" className="flex flex-col">
  <div className="flex size-14 items-center justify-center rounded-pill bg-n-1 text-indigo md:size-16">
    <svg className="size-7 md:size-8" aria-hidden="true" focusable="false" .../>
  </div>
  <h1 id="confirm-title" tabIndex={-1} className="mt-5 text-2xl font-bold ... md:text-[28px]">
  <p className="mt-3 text-lg leading-[1.7] text-n-7 break-keep">
  <div className="mt-8 flex flex-col gap-3"> [버튼들, btn-primary 최대 1개] </div>
</section>
```
- 아이콘은 error-pages D-1.2와 같은 규칙의 인라인 SVG(24px 격자, stroke 2, round, `currentColor`): `lock`(locked), `clock`(expired/invalid), `circle-check`(done), `wifi-off`(연결 불가. 기존 D-1.2). 새 의존성 없음. 색은 모두 인디고 단색(경고색을 쓰지 않는다. 사용자 탓이 아니라는 어조와 맞춤).
- 좌측 정렬(폼 화면과 같은 정렬)이라 `ErrorPanel`(중앙 정렬)은 재사용하지 않는다. 이유: 가입 흐름 안의 화면이 갑자기 오류 화면처럼 바뀌어 보이는 것을 막는다. 다만 버튼 높이 56px·아이콘·제목 크기는 error-pages 스펙과 같다.
- 연결 불가 상태(API 장애): 제목 "지금 연결이 원활하지 않아요"(정의서 2.1), [다시 시도](`btn-primary`, 새로고침) + 전화 `btn-outline`. 이때 입력한 비밀번호는 화면에 되돌려 주지 않고(서버가 응답하지 못한 요청이라 폼 상태가 클라이언트에 남아 있다면 유지), `ready` 화면에서 제출 중 연결 오류가 난 경우는 폼 상단에 `notice-danger`로 띄우고 입력을 유지한다(정의서 2.3). 페이지 로드 시 연결 불가는 이 상태 화면이다.
- 429: 폼 위쪽 `notice-danger` 한 줄, 입력 유지, 실패 횟수 박스는 없다.

#### V-2.7 상태 ⑥ 성공 후 이동

- 성공 시 서버 액션이 쿠키를 저장하고 `/my?welcome=1`로 `redirect()`한다. 중간 화면은 두지 않는다(즉시 이동이 더 단순하다).
- 제출 중(응답 대기)은 버튼이 "확인하는 중이에요" 상태. 네트워크가 느린 인앱 브라우저에서 사용자가 다시 누르지 않도록 **버튼 외 영역도 그대로 두고**, 별도 전체 화면 로딩을 덮지 않는다.
- 이동한 `/my?welcome=1`의 환영 배너는 이미 있는 컴포넌트를 쓴다. 이번 변경은 문구 한 줄 추가(7.3: "다음부터는 이메일과 방금 입력한 비밀번호로 로그인해요."). 배너 마크업이 이미 있으면 그 단락 스타일(같은 크기)을 따르고, 인앱 브라우저 사용자가 이 줄을 놓치지 않도록 `text-base text-n-8`(16px 이상)로 한다. 배너 닫기 버튼이 있다면 터치 영역 44px 이상인지 구현 때 확인.
- 포커스: 새 페이지이므로 브라우저 기본(문서 처음). 환영 배너 `<h1>` 또는 `role="status"` 영역은 기존 구현 그대로(변경 없음).
- 로그인 중이던 브라우저에서 확정하면 쿠키가 새 계정으로 바뀐다(5.6). 이동 후 헤더의 사용자 이름이 바뀌므로 환영 배너가 새 계정 이름을 보여 주는지 확인(qa-reviewer).

#### V-2.8 모바일·데스크톱 차이 (가입 마무리 전 상태 공통)

| 항목 | 모바일 375px | 데스크톱 md~ |
|---|---|---|
| 본문 폭 | `AuthLayout` `max-w-[440px]`, 좌우 24px → 실폭 327px | 같음(`max-w-[440px]`), 수직 여백만 `md:py-16` |
| 제목 | `text-2xl`(24px) | `md:text-[28px]` |
| 입력 | `h-14`, 16px, 전체 폭 | 같음 |
| 버튼 | `h-14` 전체 폭 | 같음(최대 폭이 440px이라 버튼이 지나치게 넓지 않음) |
| 접기 영역 | 탭 영역 56px | 같음. 마우스 hover는 `hover:bg-n-1`만 추가 |
| 인앱 브라우저 | 키보드가 올라와도 가려지는 고정 요소 없음, 폼 JS 없이도 제출, 16px 이상 글씨로 확대 방지 | 해당 없음 |
| 터치 영역 | 입력 56px, [보기] 48x60px, 버튼 56px, summary 56px, 텍스트 링크 `min-h-11` | 같음 |

### V-3. 관리자 회원 상세 — 미인증 회원 안내 (`app/(admin)/admin/members/[id]/page.tsx`)

**핵심 행동**: 미인증(가입 마무리 전) 회원에게 [비밀번호 재설정 메일 발송]을 눌러 가입을 마치게 한다. 관리자가 인증을 대신 처리하는 길은 없다(대표 결정 5).

#### V-3.1 레이아웃

운영 콘솔 archetype(밀도 우선, 장식 최소). 현재 상세는 `dl` 정보 그리드 → 버튼 줄(`flex flex-wrap gap-2`) 순서이며, **이 순서를 유지하고 버튼 줄 바로 위에 안내 박스 1개를 추가**한다.

```
[dl 정보 그리드]   이메일 인증 행: 배지 "가입 마무리 전" (tone=warning)
[안내 박스 — emailConfirmed === false 일 때만]
[버튼 줄]  [비밀번호 재설정 메일 발송] (주)   ※ "이메일 인증완료 처리" 버튼은 emailConfirmed === false 일 때 렌더하지 않는다
```

- 현재 코드의 `emailConfirmed === false &&` 분기(91~99행의 `ConfirmDialog`)는 **삭제가 아니라 안내 박스로 교체**한다. `emailConfirmed === true`이거나 `null`(확인불가)일 때는 안내 박스를 보이지 않고 버튼 줄은 현재와 같다(`[비밀번호 재설정 메일 발송]`만).
- 이유: 버튼을 없애면 관리자가 "왜 없지?"를 찾게 된다. 있던 자리에 이유와 대체 방법을 두면 되돌아가 헤매지 않는다. 안내 박스가 버튼 줄 위에 있어 읽은 뒤 바로 아래 버튼을 누른다.

#### V-3.2 구성 요소

배지: 기존 `StatusBadge tone="warning"`, 라벨 "가입 마무리 전"(정의서 7.3 제안, ux-writer가 최종). 목록·대시보드의 "미인증" 표기도 같은 라벨로 바꾸자는 제안은 3.2절대로 ux-writer 결정.

안내 박스(신규 컴포넌트를 만들지 않고 기존 마크업 + 클래스)
```
<div role="note" aria-labelledby="unverified-note-title"
     className="flex gap-3 rounded-md border border-n-3 border-l-4 border-l-warning bg-n-1 px-4 py-3 text-[13px] leading-[1.6] text-n-8">
  <svg className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" ... />   /* info 또는 triangle-alert, 인라인 SVG */
  <div className="flex flex-col gap-1">
    <p id="unverified-note-title" className="font-semibold text-n-9">가입을 마무리하기 전 회원이에요</p>
    <p>이 회원은 아직 가입을 마무리하지 않아 비밀번호가 없어요. 비밀번호 재설정 메일을 보내면 회원이 직접 비밀번호를 정하고 가입을 마칠 수 있어요.</p>
    <p className="text-n-6">재설정 메일은 가입 이메일로만 가요. 메일을 받은 사람이 곧 이메일 주인이니, 이름이 달라도 이메일만 확인하고 보내 주세요.</p>   {/* 대표 결정 6의 본인 확인 절차(이메일만, 2026-11-26 정정) */}
  </div>
</div>
```
- 글씨는 관리자 콘솔 기준에 맞춰 13px(기존 `dl`, 목록과 같음)로, 데스크톱 전용 화면이라 시니어 큰 글씨 규칙(18px)을 적용하지 않는다. 그래도 `n-8` 위 `n-1`로 대비는 약 12:1이다. 보조 줄의 `text-n-6`은 약 4.8:1로 통과.
- `border-l-warning`(#F0963C)은 비텍스트 강조선이라 3:1 기준이 느슨하지만(흰 배경 대비 약 2.2:1) 의미를 색에만 의존하지 않는다. 제목 문구와 배지 라벨이 같은 정보를 전한다. 더 안전하게 하려면 `border-l-n-7`로 바꿔도 된다(구현자 판단, 토큰은 모두 기존).
- 버튼: 기존 `ConfirmDialog`(`triggerLabel="비밀번호 재설정 메일 발송"`)를 그대로 쓴다. 미인증 상태에서는 이 버튼이 **채운(주) 스타일**이어야 안내와 이어진다. `ConfirmDialog`가 주/보조 스타일 변형을 이미 지원하는지 구현 때 확인하고, 없으면 `variant?: 'primary' | 'default'` 선택 props를 추가한다(기본값은 현재 스타일). 인증 완료 회원에서는 기본 스타일 유지.
- 확인 다이얼로그 문구(`description`)는 현재 "…회원은 메일의 링크로 새 비밀번호를 설정한 뒤 바로 로그인할 수 있어요."를 쓴다. 미인증 회원에게는 "**가입도 함께 마무리돼요**" 취지가 빠지면 의도와 다르므로, `emailConfirmed === false`일 때만 설명을 별도 문구로 바꾼다(ux-writer 확정).
- 인증 처리 거절(API 409 `password_not_set`)이 어떤 경로로든 올 수 있는 경우(구 화면 캐시 등)의 `?error=` 안내는 기존 오류 알림 위치에 `notice` 한 줄로 표시한다(정의서 7.3 "관리자 인증 처리 거절" 문구). 별도 화면 없음.

#### V-3.3 포커스·aria

- 안내 박스는 정적 정보이므로 `role="note"`, 라이브 영역 아님. 제목은 `aria-labelledby`로 연결. 키보드 포커스 대상이 아니다(링크·버튼 없음).
- 탭 순서는 기존 순서 유지(정보 → 버튼). `ConfirmDialog`는 기존 `<dialog>` 포커스 규칙(열면 확인/취소로 이동, 닫으면 트리거로 복귀)을 그대로 따른다. 이 변경에서 다이얼로그 동작은 바뀌지 않는다.
- 배지는 텍스트라 스크린리더에서 그대로 읽힌다.
- 재설정 메일 발송 후 결과 토스트/배너는 기존 `?notice=` 방식을 따른다(변경 없음).

#### V-3.4 모바일·데스크톱 차이

- 관리자 콘솔은 데스크톱 우선(최소 1280px)이라 모바일 전용 레이아웃은 정의하지 않는다. 좁은 폭에서도 깨지지 않도록 `flex-wrap`(버튼 줄)과 `flex gap-3`(안내 박스)는 줄바꿈이 되게 둔다.
- 안내 박스는 `AdminShell`의 `main`(`p-6`) 안에서 `dl` 그리드와 같은 폭(`w-full`)이며, 데스크톱에서 문장이 너무 길어지지 않게 `max-w-[720px]`를 쓴다.

### V-4. 구현 시 컴포넌트 매핑 (publisher·frontend-developer용)

| 화면 요소 | 컴포넌트 | 비고 |
|---|---|---|
| 가입 폼 비밀번호 두 칸 | 신규 `PasswordField`(`components/auth/`) | `AuthForm`의 `Field`와 별개. 가입 마무리 화면 비밀번호 칸이 재사용 |
| 가입 마무리 폼 | 신규 `SignupFinishForm`(`components/auth/`) | 상태 ①②를 렌더, `<details>` 포함 |
| 상태 화면(③④⑤·연결 불가) | 신규 `SignupLinkStatus`(`components/auth/`) | V-2.6 구조 하나로 4종 |
| 메일 다시 받기 | 기존 `ResendConfirmationForm` + `size` props | 기본값은 현재 모양 |
| 인라인 아이콘 | `lock`, `clock`, `circle-check`, `chevron-down`, `check` 인라인 SVG 추가 | `triangle-alert`·`phone`·`refresh-cw`·`wifi-off`는 error-pages D-1.2 것을 재사용 |
| 관리자 안내 | 기존 `StatusBadge`, `ConfirmDialog`, 신규 마크업 한 블록 | 별도 컴포넌트 불필요 |

### V-5. 접근성 점검표 (qa-reviewer용)

| 항목 | 기준 |
|---|---|
| 글씨 크기 | 가입 마무리 본문 16px 이상(보조문 14px는 힌트에 한정) |
| 터치 영역 | 입력 56px, 버튼 56px, [보기] 48px 높이/60px 폭, summary 56px, 텍스트 링크 44px |
| 대비 | 본문 `n-9/n-8/n-7/n-6`만. `n-5`, `danger`, `success`는 글자에 쓰지 않음 |
| 색만으로 전달 | 오류는 아이콘+문구+선, 횟수는 숫자 문구, 점은 장식 |
| 키보드 | 모든 요소 Tab 이동, `focus-ring` 3px 인디고, `<details>`는 Enter/Space |
| 스크린리더 | 라벨 연결, `aria-invalid`/`aria-describedby`, 토글 `aria-label`, 점 `aria-hidden`, 상태 전환 후 `h1` 포커스 |
| 동작 감소 | `motion-reduce:animate-none`, `motion-reduce:transition-none` |
| JS 없이 | 폼 제출과 `<details>` 동작 |
| 인앱 브라우저 | 고정 하단 바 없음, 입력 16px, 자동 입력 실패 시 [보기]로 확인 가능 |

### V-6. 사용성 위험과 제안 (능동 지적)

1. **불필요한 클릭**: 3회째부터 자동 펼침은 좋지만 오류 박스 도움말 끝에 펼침이 있다는 단서가 없으면 못 볼 수 있다. 한 줄 추가 제안(V-2.2).
2. **[메일 다시 받기]가 조용히 아무것도 안 보낼 수 있음**: 보관 기간 지난 시도·옛 링크는 열거 방지 때문에 성공 문구가 나간다. 사용자가 헛기다린다. 성공 문구에 다시 가입 안내 포함 + 버튼 유지(V-2.4). 근본적으로는 backend에서 `invalid` 응답을 구분하지 않으므로 화면이 할 수 있는 최선이다.
3. **인앱 브라우저에서 쿠키가 분리됨**(5.6): 가입 후 평소 브라우저에서는 로그인이 안 되어 있다. 환영 배너의 "다음부터는 이메일과 방금 입력한 비밀번호로 로그인" 한 줄이 중요하다. 문구를 놓치지 않게 16px 이상으로(V-2.7).
4. **기존 가입 폼 크기(13px, 핑크 버튼)**: 새 화면과 시각 불일치. 이번 범위에서는 두 비밀번호 칸만 올리고, 전체 통일은 별도 제안(V-9).
5. **비밀번호 "보기" 후 화면 공유·옆 사람**: 기본은 숨김이며 제출 때 되돌린다. 안내 문구는 불필요하다.

### V-9. 이번 범위 밖 제안

- 가입·로그인 폼 전체 글씨(13px) 상향과 핑크 주 버튼 대비(약 4.4:1) 개선: 별도 작업으로 PO 승인 필요.
- `AppHeader`(12.5px, 터치 영역 작음)는 error-pages D-9 제안과 같다.

### V-10. 확인·결정 필요 (이 스펙의 TBD)

| # | 항목 | 기본값(이 스펙) | 확인 대상 |
|---|---|---|---|
| 1 | 최종 문구 전부(제목·안내·오류·횟수·도움말·접기·상태 화면·관리자 안내) | 정의서 7장 초안 | ux-writer (F8) |
| 2 | `/auth/confirm/page.tsx`를 `app/(auth)/auth/confirm/`에 두는 방식 | 두 개의 경로가 같은 URL이 되지 않는지 확인 후 채택 | frontend-developer |
| 3 | `sign-in` 화면의 카드형 마크업과 비밀번호 재설정 요청 경로 | 구현 때 같은 모양으로 맞춤 | frontend-developer |
| 4 | `ConfirmDialog`의 주/보조 스타일 변형 유무 | 없으면 선택 props 추가(기본값 유지) | frontend-developer |
| 5 | 두 칸의 [보기] 토글을 하나로 묶을지 | 따로(예측 가능) | PO 의견이 있으면 변경 |
| 6 | 관리자 안내 박스 왼쪽 선 색(`warning` 또는 `n-7`) | `warning` | 구현자 판단 |
| 7 | 환영 배너의 기존 마크업·닫기 버튼 크기 | 구현 때 확인 | frontend-developer |
