# 관리자 회원 이름·연락처 수정 — API 확정 계약

- 작성: backend-developer, 2026-11-26
- 근거: `bara-edu-lms.admin-profile-edit.md` 9장 초안 + 맨 끝 '결정(ceo-advisor 위임 판단)'. 이 문서가 구현 기준이다. 초안과 다른 곳은 5장에 모았다.
- 대상 독자: frontend-developer(앱 연동), qa-reviewer, privacy-security-officer

## 1. 확정한 세 가지

| 항목 | 결정 | 이유 |
|---|---|---|
| 변경 안내 메일의 `link` | **필수 유지**. `MailMessage` 모양은 그대로 두고 `link = {사이트 주소}/sign-in`(로그인 화면)을 넣는다 | 메일 타입·SES 본문 조립을 건드리지 않는다. 회원이 본인 계정 상태를 바로 확인하러 갈 수 있는 링크라 쓸모도 있다. 사이트 주소는 클라이언트가 보내지 않고 API 설정(`SITE_ORIGINS`의 첫 값)을 쓴다 |
| 접속 기록 `action` | **`정보수정`** (기존 `조회`·`수정`과 같은 한글 관례, `수정`과 구분) | 이력 조회가 `detail` 파싱 없이 action으로 걸러낸다 |
| 접속 기록과 변경 | **같은 트랜잭션**. 기록 insert가 실패하면 변경 전체 롤백, `503 log_failed` | 마스킹 해제 원칙과 같다 |

`detail` 고정 형식(키=값, `;`로 구분): `fields=name,phone;reason=member_request;verified=email[;memo=<encodeURIComponent 값>]`. 값(이전·새 이름·전화)은 절대 넣지 않는다. memo는 `;`·`=`가 들어올 수 있어 URI 인코딩한다.

## 2. 공통

- 호출은 서버 간(앱 서버 -> API). 헤더: `x-bara-service-key`, `x-bara-session`(관리자 세션), 가능하면 `x-bara-client-ip`(접속 기록 `ip_address`에 들어간다).
- 기존 오퍼레이션 규칙: `POST /v1/op/<이름>`, 본문 `{ "params": { ... } }`, 성공 응답 `{ "data": ... }`. 업무상 결과는 HTTP 200의 `data.result` 문자열로 돌려준다(`enrollments.approve`와 같다).
- HTTP 오류(`{ "error": { code, message } }`): 400 `validation`(params 모양이 틀림, 모르는 키 포함), 401 `unauthenticated`(세션 없음), 503 `unavailable`(접속 기록 실패, `message: "log_failed"`), 500.
- 접근 권한: 두 오퍼레이션 모두 `profiles.role = 'admin'`만. 아니면 `data.result = 'forbidden'`.

## 3. `POST /v1/op/admin.updateMemberProfile`

요청 `params` (모르는 키는 400. role·status·email·address·photo_path 등은 보내도 거절된다)

```json
{
  "memberId": "uuid",
  "name": "홍길동",
  "phone": "010-1234-5678",
  "expected": { "name": "홍길순", "phone": null },
  "reason": "member_request",
  "memo": null,
  "identityChecked": true
}
```

| 필드 | 규칙 |
|---|---|
| `memberId` | uuid |
| `name` | 선택. 보낸 필드만 바꾼다. 앞뒤 공백 제거, 가운데 연속 공백은 한 칸, 2~100자(유니코드 문자 수), 제어 문자 불가, `탈퇴한 회원` 불가 |
| `phone` | 선택. 문자열 또는 `null`(비움). 앞뒤 공백 제거 후 빈 문자열도 비움. 7~30자, 허용 문자 숫자·공백·`-`·`+`·`(`·`)`, 숫자 7개 이상. `*`가 있으면 `phone_masked` |
| `expected` | **필수.** 보낸 필드 각각의 편집 시작 시점 값(`name`: 문자열, `phone`: 문자열 또는 `null`). 보낸 필드의 expected 키가 없으면 `field: "expected"` |
| `reason` | `member_request` \| `typo_fix` \| `signup_attempt_value` \| `other` |
| `memo` | 선택. 최대 100자, 한 줄. `other`면 5~100자 필수. 숫자 7개 이상(공백·`-`·`.` 사이 포함)이나 이메일 형태는 `memo_has_pii` |
| `identityChecked` | `true`만 허용 |

기존에 저장된 값이 위 규칙을 못 지켜도, 요청 값이 현재 값과 글자까지 같으면(바꾸지 않는 칸) 그 칸은 검증하지 않는다.

응답 `data` (모두 HTTP 200)

| `result` | 추가 필드 | 의미 | 접속 기록·메일 |
|---|---|---|---|
| `ok` | `changed: ("name"\|"phone")[]`, `profile: { name, phone }`, `mailQueued: true` | 저장됨 | 기록 1건, 메일 대기열 |
| `unchanged` | `changed: []`, `profile` | 요청 값이 이미 현재 값과 같음(변경 없음·재시도 중복) | 없음 |
| `stale` | `current: { name, phone }` | `expected`가 현재 값과 다름(동시 편집) | 없음 |
| `validation` | `field`, `reason` | 아래 표 | 없음 |
| `withdrawn` | | 탈퇴 회원 | 없음 |
| `not_confirmed` | | 가입 마무리 전(`email_confirmed_at` 없음) | 없음 |
| `target_is_admin` | | 대상이 관리자 계정 | 없음 |
| `no_email` | | 가입 이메일 없음(본인 확인 불가) | 없음 |
| `not_found` | | 회원 없음 | 없음 |
| `forbidden` | | 호출자가 관리자 아님 | 없음 |

`validation`의 `field` / `reason`: `name`/`name_length`·`name_control`·`name_reserved`, `phone`/`phone_length`·`phone_chars`·`phone_digits`·`phone_masked`, `reason`/`reason_required`, `memo`/`memo_required`·`memo_length`·`memo_has_pii`, `identityChecked`/`not_checked`, `expected`/`expected_missing`, `name`/`none`(name·phone 둘 다 안 보냄).

`mailQueued`: 커밋 뒤 메일을 대기열에 넣었다는 뜻이다. SES 발송 결과는 기다리지 않고(기존 `deliver`와 같다) 실패해도 변경은 성공이다. 대기열 등록 자체가 예외를 내도 응답은 `ok`이며 `mailQueued: false`.

처리 순서(한 트랜잭션): 관리자 확인 -> 입력 검증(사유·메모·본인 확인) -> 락 `auth.users`(없으면 `not_found`) -> `profiles` -> 상태 검사(`not_found`, `target_is_admin`, `withdrawn`, `not_confirmed`, `no_email`) -> 이름·전화 검증 -> 현재 값 비교(요청 = 현재면 `unchanged`, `expected` ≠ 현재면 `stale`) -> `profiles`의 바뀐 컬럼만 update + `auth.users.raw_user_meta_data`의 `name`/`phone` 키만 갱신(다른 키 보존, 전화를 비우면 `phone` 키 삭제) -> `admin_access_logs` insert(`admin_id` = 호출 관리자, `target_user_id`, `action='정보수정'`, `detail`, `ip_address`) -> 커밋 -> 메일. 락 순서는 기존 규칙(토큰 -> 시도 -> 사용자 -> profiles)을 따른다(`lockUserSignupIn` 재사용).

메일(`profile_changed`): 가입 이메일(`profiles.email`)로. 제목 `[바라 평생교육원] 회원 정보가 수정됐어요`. 항목명(이름, 연락처)과 시각(KST)만, 값은 없다. 고객센터 전화·운영시간은 기존 푸터 블록을 쓴다.

## 4. `POST /v1/op/admin.listMemberProfileEdits`

```json
{ "params": { "memberId": "uuid", "limit": 5 } }
```

`limit`은 선택(기본 5, 최대 50). 응답 `data`:

```json
{ "result": "ok", "items": [ { "at": "2026-11-26T05:12:00.000Z", "adminName": "관리자A", "fields": ["name"], "reason": "member_request", "memo": null } ], "hasMore": false }
```

- `admin_access_logs`에서 `target_user_id = memberId and action = '정보수정'`, 최근 순. 값은 없다.
- `adminName`: 처리한 관리자의 `profiles.name`. 탈퇴한 관리자는 `null`(화면이 "(탈퇴)"로 표시).
- 관리자가 아니면 `result: "forbidden"`. 회원이 없어도 빈 목록(`not_found` 구분 안 함).
- 이 조회는 접속 기록을 남기지 않는다(상세 조회 기록에 포함).

## 5. 초안(9장)과 다른 점

| 초안 | 확정 | 이유 |
|---|---|---|
| `PATCH /v1/admin/users/:id/profile` | `POST /v1/op/admin.updateMemberProfile` | 대표 요청. 오퍼레이션 틀(`withService` 트랜잭션, 세션 확인)을 재사용 |
| HTTP 409/404/403으로 구분 | 200 + `data.result` | 기존 오퍼레이션(`enrollments.approve`)과 같은 방식 |
| 입력 `origin` | 없음 | 클라이언트가 보낸 주소를 링크에 쓰지 않는다. API 설정의 사이트 주소 사용 |
| 입력 `identityVerified` | `identityChecked` | 대표 요청 이름 |
| 검증 실패 400 | 200 + `validation`(`field`, `reason`) | 칸별 안내를 위해. 모양 자체가 틀린 요청만 400 |
| 이력 `GET .../profile-edits` | 오퍼레이션 `admin.listMemberProfileEdits` | 같은 틀 |
| 429 쓰기 한도(선택) | 구현하지 않음 | 선택 항목. 관리자 수가 적고 접속 기록이 남는다 |
| `detail`의 사유 | 코드(`member_request`) 그대로 | 라벨은 화면이 변환 |

DB 스키마 변경은 없다(`admin_access_logs.action`이 자유 문자열이고 `target_user_id` 인덱스가 이미 있다). 운영 패치 SQL도 필요 없다.
