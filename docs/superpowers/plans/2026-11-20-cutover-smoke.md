# 앱 전환(2차) 로컬 통합 확인 — 체크리스트와 결과

- 일시: 2026-11-23, 브랜치 `feat/app-cutover`
- 대상: 루트 Next.js 앱(`next dev`, :3000) + `api/` 서버(`node --env-file=.env dist/server.js`, :3100) + 테스트용 PostgreSQL 18 컨테이너(:54329, DB `bara_edu_smoke`)
- 운영 Supabase·AWS(S3·SES·SSM)에는 접속하지 않았다. API는 `BARA_DEV_FAKES=1`(메모리 메일러·메모리 저장소, 메일 링크는 로그로 출력)로, 앱은 `BARA_API_SERVICE_KEY`·`BARA_PII_REVEAL_SECRET` 환경변수로(SSM 미사용) 실행했다.
- 방법: 헤드리스 Chrome(playwright-core, 로컬 설치본)으로 실제 화면을 열고 폼을 제출했다(서버 액션은 브라우저 제출 그대로). 메일 링크는 API 로그의 `[dev-mail]` 줄에서 꺼냈고, 결과는 화면 문구·주소와 DB 조회로 함께 확인했다.

## 준비 절차

```bash
cd api
npm run db:up
docker exec api-db-1 psql -U postgres -c "create database bara_edu_smoke"
export DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:54329/bara_edu_smoke
BARA_APP_DB_PASSWORD=<로컬 비밀번호> npm run db:bootstrap
npm run db:migrate
npm run db:seed-dev          # localhost DB이고 @dev.local 외 회원이 없을 때만 실행됨. 관리자 admin@dev.local, 학습자 learner@dev.local, 강좌 dev-shape-course(레슨·퀴즈·시험 문항·계좌 각 1)
# api/.env: DATABASE_URL(bara_edu_app), BARA_SERVICE_KEY, SITE_ORIGINS=http://localhost:3000(BARA_DEV_FAKES는 로컬 주소만 허용), BARA_DEV_FAKES=1
node --env-file=.env dist/server.js

# 루트 .env.local: BARA_API_URL=http://localhost:3100, BARA_API_SERVICE_KEY(api와 같은 값), BARA_PII_REVEAL_SECRET(32바이트 이상), NEXT_PUBLIC_IS_OPEN=true
npm run dev
```

시드 계정의 비밀번호는 `api/test/helpers/seed-dev.ts`에 있다(로컬 전용 고정값).

## 결과

| # | 항목 | 결과 |
| --- | --- | --- |
| 1 | 가입 → 인증 메일 링크 → `/auth/confirm` → `/my` | ✅ 확인 (`/sign-up` 제출 → 세션 쿠키 없음 → `[dev-mail] confirm` 링크 열기 → `/my?welcome=1` 환영 문구, `bara_session` 쿠키 httpOnly·SameSite=Lax·path=/. 같은 링크 재사용·잘못된 토큰 → `/sign-in?confirmError=1`) |
| 2 | 로그아웃·로그인 | ✅ 확인 (헤더 "로그아웃" → `/`, 쿠키 삭제. 비로그인 `/my` → `/sign-in?redirect=/my`. 틀린 비밀번호는 "이메일 또는 비밀번호가 올바르지 않아요", 맞는 비밀번호 → `/my`) |
| 3 | 비밀번호 변경 | ✅ 확인 (`/my?tab=password` 제출 → `/my?settingsSuccess=password` "비밀번호를 변경했어요", 현재 세션 유지. 새 창에서 이전 비밀번호 거절, 새 비밀번호 로그인) |
| 4 | 재설정 메일 링크로 재설정 | ✅ 확인 (관리자 회원 상세 "비밀번호 재설정 메일 발송" → `[dev-mail] recovery` 링크 → `/reset-password?token=` 제출 → `/sign-in?reset=1` "비밀번호가 변경됐어요". 같은 링크 재사용 시 "비밀번호 변경에 실패했어요…" 문구. 기존 세션 전부 폐기, 새 비밀번호 로그인). 학습자가 직접 재설정 메일을 요청하는 화면은 전환 전에도 없었다(관리자 발송만) |
| 5 | 강좌 목록·상세 | ✅ 확인 (비로그인 `GET /courses` 200·시드 강좌 표시, `/courses/dev-shape-course` 200·커리큘럼 표시, 없는 slug 404) |
| 6 | 수강 신청(사진 업로드 포함) | ✅ 확인 (신청 화면에 계좌 표시. 이미지가 아닌 파일 → `?error=photo-invalid`. 주소+PNG+동의 제출 → 강좌 상세로 이동, DB `enrollments.status=pending`, `profiles.photo_path=<uid>/photo`, 메모리 저장소에 업로드) |
| 6a | 실제 S3에 사진 저장·서명 URL로 이미지 표시 | 로컬 미확인 — 리허설에서 확인 (가짜 저장소는 `memory://` 주소를 돌려줘 브라우저가 이미지를 그리지 못한다. S3 버킷·컴퓨트 역할이 필요) |
| 7 | 관리자 승인 | ✅ 확인 (`/admin/enrollments` 해당 행 "승인" → DB `approved`). 승인 전·진도 0%에서 탈퇴 시도 → `?withdrawError=active-enrollment` |
| 8 | 레슨 진도·퀴즈 제출 | ✅ 확인 (강의 화면 "학습 완료" → "완료됨"·`progress` 1건, 퀴즈 정답 제출 → `?quizScore=100`·`quiz_submissions.score=100`) |
| 9 | 시험 응시 | ✅ 확인 — 처음엔 ❌ 실패(`submit_course_exam`이 42702 `column reference "passed" is ambiguous`로 500, 화면 `?error=exam-failed`). `api/db/02-schema.sql`에서 열을 별칭으로 한정해 고치고 `api/test/rpc.test.ts`에 테스트 추가. 수정 후 정답 제출 → `score=100, passed=true` |
| 10 | 수료증 발급 | ✅ 확인 — 처음엔 ❌ 실패(`issue_certificate_self`가 42702 `column reference "issued_at" is ambiguous`로 500, `?error=certificate-failed`). 같은 방식으로 고치고 테스트 추가. 수정 후 "수료증 발급" → `?certificateIssued=1`, `certificates` 1건, `/my` 수료증 목록 표시 |
| 11 | 자가진단 제출·결과 조회·회원 귀속 | ✅ 확인 (로그인 상태 30문항 제출 → 결과 화면·자동 귀속·`/my?tab=diagnosis` 표시. 비회원 제출(미귀속) → 같은 브라우저에서 로그인 후 결과 열기 → 귀속. 비회원 제출 → 결과 화면의 가입 링크 → 가입·메일 인증 → 자동 귀속. 다른 회원이 링크를 열면 "이미 다른 계정에 연결되어 있어요") |
| 12 | 관리자 회원 목록(인증 상태 표시) | ✅ 확인 (목록에서 미인증 가입자 "미인증", 인증 회원 "인증완료". 상세 "이메일 인증완료 처리" 후 그 회원 로그인 성공. 방금 가입한 회원은 앱의 60초 인증상태 캐시 때문에 상세에서 최대 60초간 "확인불가"로 보인다 — 기존 설계대로) |
| 13 | 관리자 사진 열람 | ✅ 확인 (회원 상세 `img src` = 60초 서명 URL, 상세 조회가 `admin_access_logs`에 기록) — 실제 이미지 표시는 6a와 같이 리허설에서 확인 |
| 14 | PII 열람 로그 | ✅ 확인 (`/admin/selfcheck` 연락처 기본 마스킹. `revealPii`만 붙이거나 위조 토큰을 붙이면 마스킹 유지·기록 0건. "개인정보 보기" → 원문 표시 + `admin_access_logs` "진단 결과 연락처 열람(<id>)" 기록) |
| 15 | 약관 게시 | ✅ 확인 (`/admin/cms/new` 작성 → 초안은 `/legal/<slug>`에 안 보임 → "이 버전 게시" → 공개. 2판 작성·게시 → 공개 화면 2판, DB 1판 게시 해제) |
| 16 | 탈퇴 후 재로그인 불가 | ✅ 확인 (수료 후 `/my` "회원 탈퇴"(사유 선택) → `/?withdrawn=1`, 쿠키 삭제. 다른 브라우저의 같은 회원 세션도 폐기(`/my` → `/sign-in`). 원래 이메일·비밀번호로 로그인 거절. DB: profiles·auth.users 이메일 `withdrawn+<id>@deleted.invalid`, 주소·사진 경로 비움, progress 0건, 세션 0건, 수료증 보존) |
| 17 | 권한·세션 | ✅ 확인 (학습자가 `/admin` → `/`. API에 없는 세션 쿠키 → `/sign-in`·쿠키 삭제. 서비스 키 없이 API 호출 → 401 `unauthorized_service`. 다른 학습자 세션으로 `enrollments` 필터 없이 조회 → 0건(RLS)) |
| 18 | 전체 화면 GET | ✅ 확인 (관리자 화면 21개, 학습자·공개 화면 19개(`/my` 탭 7개 포함)를 각 역할로 열어 4xx/5xx·오류 화면 없음) |
| 19 | 실제 메일 발송(SES)·메일 본문 | 로컬 미확인 — 리허설에서 확인 (SES 발신 도메인·자격 증명 필요. 로컬은 링크만 로그로 확인) |
| 20 | SSM에서 서비스 키·PII 서명 키 읽기 | 로컬 미확인 — 리허설에서 확인 (Amplify 컴퓨트 역할 필요. 로컬은 환경변수 경로로 실행) |
| 21 | Amplify 빌드(`amplify.yml`)·운영 쿠키 `secure` | 로컬 미확인 — 리허설에서 확인 (`BARA_API_URL`을 Amplify 콘솔 환경변수로 등록해야 `.env.production`에 들어간다. `secure`는 `NODE_ENV=production`에서만 켜진다) |
| 22 | 화면 모양·반응형·영상 재생 | 수동 확인 필요 (자동 확인은 문구·주소·DB 상태만 본다. 레이아웃 깨짐, 모바일 폭, YouTube 재생, 결과 화면 인쇄는 직접 눌러봐야 한다) |

## 확인 중 알게 된 것

- 9·10의 두 결함은 `supabase/schema.sql`(운영 Supabase)에도 같은 코드로 있다. 운영에서 자격시험 제출·수료증 자가 발급이 지금도 실패하고 있을 가능성이 높다(이 작업에서는 운영에 접속하지 않아 확인하지 못했다).
- `submit_diagnosis`는 같은 연락처의 짧은 시간 내 재제출을 `duplicate submission too soon`으로 막는다. 확인을 반복할 때는 연락처를 매번 바꿔야 한다(의도된 동작).
- 가입·로그인은 IP당 횟수 제한이 있어(로컬은 `::1` 하나) 확인을 여러 번 돌리면 429가 난다. 로컬 DB에서 `delete from auth.rate_events`로 비우고 다시 돌렸다.
- `/admin/bank-accounts`에서 React hydration 경고: 계좌 수정 `<form>` 안에 삭제 `ConfirmDialog`의 `<form>`이 중첩돼 있다. main에도 있는 기존 문제이며 이번 전환과 무관하다.

## 전환 직후 수동 확인

운영 전환(11/24) 직후 실제 기기로 확인한다. 항목마다 확인한 사람·시각을 적는다.

- [ ] 1. 실제 Gmail·Naver 계정으로 가입 → 인증 메일 링크 → `/my?welcome=1`. iPhone 메일 앱의 인앱 브라우저에서도 확인. 세션 쿠키가 Secure·HttpOnly·SameSite=Lax.
- [ ] 2. 기존 계정 로그인, 관리자 계정으로 `/admin` 접근.
- [ ] 3. iPhone 사진(2~4MB)으로 수강신청. HEIC는 거절된다. 관리자 회원 상세에서 사진이 보인다.
- [ ] 4. 승인 → `/learn` → 강의 완료 처리, YouTube 재생을 PC·iPhone Safari·인앱 브라우저에서 확인.
- [ ] 5. 자격시험 제출과 수료증 발급.
- [ ] 6. 관리자 비밀번호 재설정 메일 처음부터 끝까지(이미 쓴 링크를 다시 열었을 때 포함).
- [ ] 7. 모바일 레이아웃(폭 375px 이하): 홈, 강좌 목록, 강좌 상세, 신청, 로그인, 가입, 강의실, 마이페이지.
- [ ] 8. 강좌 3개의 수강료·정원·정부지원 배지·계좌 정보가 전환 전 값과 같다.
- [ ] 9. 비회원으로 자가진단 → 인쇄 미리보기 → 가입 후 자동 연결(claim).
- [ ] 10. 시크릿 창에서 보호 경로 접근, 일반 회원은 `/admin`에서 밀려남, 없는 slug는 404.
- [ ] 11. Wi-Fi와 LTE에서 각각 가입·로그인 — 요청 제한 버킷이 서로 다르다.
- [ ] 12. 브라우저를 닫았다 열어도 로그인 유지, 쿠키 만료는 30일 뒤.
- [ ] 13. 관리자 개인정보 보기(원문 열람)가 되고 접속 기록이 남는다.
- [ ] 14. 테스트 계정 탈퇴: 재로그인 거절, 다른 세션 끊김, S3 사진 객체 삭제됨.
- [ ] 15. 동시 업로드 중 API 메모리가 `MemoryMax=256M` 안에 머문다.
