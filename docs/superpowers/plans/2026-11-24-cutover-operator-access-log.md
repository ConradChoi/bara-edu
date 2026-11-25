# 서버 전환 운영자 접근 기록 (2026-11-23 ~ 11-26)

런북 10번 "운영자 접근 기록". 이관·DB 관리자 작업마다 누가·언제·무엇을 했는지 남긴다.

- 승인: 대표(최종훈) — 항목마다 대화로 확인 후 실행
- 실행: Claude Code(대표의 로컬 세션) → `ssh ylia-was`(EC2 Instance Connect) → WAS에서 Node `pg`로 접속
- 접속 정보: WAS `~/bara-edu-ops/*.env`(0600)에만 두고 화면·대화에 출력하지 않음. 2026-11-24 13:10 KST에 파일 삭제(아래 마지막 항목)
- 시각은 KST, 대화 기록의 명령 실행 시각 기준(분 단위)

| 일시(KST) | 대상 | 작업 종류 | 조회·변경 범위 |
|---|---|---|---|
| 11-23 21:17 | ylia-pg-01(RDS 마스터) | 조회 | DB·역할 목록 확인 |
| 11-23 22:25 | ylia-pg-01 | 변경 | `bara_edu`·`bara_edu_staging` DB 생성, 역할 4개 부트스트랩(`db:bootstrap`) — 42501 오류로 중단 |
| 11-23 22:27 | `bara_edu` | 변경(롤백) | 역할·스키마 적용을 롤백 트랜잭션으로 시험(0f61947 수정 확인) |
| 11-23 22:28 | `bara_edu`·`bara_edu_staging` | 변경 | 부트스트랩·스키마 적용(`db:migrate`), 앱 계정 로그인 확인 |
| 11-24 08:12 | 운영 Supabase(읽기 전용) → `bara_edu_staging` | 조회·적재 | 리허설 이관(회원·전체 public 테이블). 원본은 REPEATABLE READ READ ONLY |
| 11-24 08:27 | Supabase → `bara_edu_staging`, Supabase Storage → S3 | 조회·적재 | 스테이징 초기화 후 사진 포함 재이관(사진 2건) |
| 11-24 08:40 ~ 09:51 | `bara_edu_staging` | 조회 | 리허설 확인: 요청 제한 IP 키, 세션, 가입 행(테스트 계정만), SES 발송 지표 |
| 11-24 10:53 | Supabase(읽기 전용) → `bara_edu`, Storage → S3 | 조회·적재 | 최종 운영 이관(사진 포함). 건수·체크섬 전부 일치, 사진 2/2 |
| 11-24 13:04 ~ 13:06 | `bara_edu` | 조회 | `legal_documents` 버전 목록과 개인정보처리방침 v2 본문(공개 문서) |
| 11-24 13:09 | ylia-pg-01 | 조회 | `bara_edu*` DB 목록·접속 수·크기 |
| 11-24 13:10 | ylia-pg-01 | 변경 | `bara_edu_staging` 삭제(리허설 복사본, 실제 회원 이메일 포함 — 리허설 당일 삭제) |
| 11-24 13:10 | WAS `~/bara-edu-ops` | 삭제 | `admin.env`(마스터 URL)·`migrate.env`(Supabase DB URL·서비스 키)·`app-db.env`·`supabase-ca.crt` 삭제 |
| 11-25 17:1x | `bara_edu`(앱 계정 `bara_edu_app`, WAS `api.env`) | 조회 | R24: 퀴즈 함수 2개의 소유자 확인(`pg_proc`) |
| 11-25 17:17 | `bara_edu`(앱 계정 → `set local role bara_edu_service`, 읽기 전용 트랜잭션) | 조회 | R24 배포 전 점검: 겹친 퀴즈 회차 0건, 정답 없는 문항 0건(문항·제출 모두 0건) |
| 11-25 17:17 | `bara_edu`(앱 계정 → `set local role bara_edu_service`) | 변경 | R24 패치 `api/db/patches/2026-11-25-r24.sql` 적용: `get_quiz_for_lesson`·`submit_quiz_attempt` create or replace(데이터 변경 없음) |
| 11-25 17:18 | WAS `bara-edu-api` | 변경 | API 릴리스 `98ac9b9` 설치·재시작(healthz 200) |
| 11-25 20:58 | `bara_edu`(앱 계정 → `set local role bara_edu_service`, 읽기 전용) | 조회 | 가입 비밀번호 확인 설계용 미인증 계정 수(0건) |
| 11-25 21:55 | `bara_edu`(앱 계정 → `set local role bara_edu_service`) | 변경 | 패치 `2026-11-25-signup-attempts.sql` 적용: `auth.signup_attempts` 생성, `email_tokens.attempt_id` 추가, 정리 함수 교체(이행 대상 0건) |
| 11-25 21:56 | WAS `bara-edu-api` | 변경 | API 릴리스 `ef57636` 설치·재시작(healthz 200) |
| 11-25 21:56 | `bara_edu`(동일) | 변경 | 같은 패치 재적용(API 배포 직후 절차, 이행 대상 0건) |
| 11-26 06:43 | WAS `bara-edu-api` | 변경 | API 릴리스 `3ba761f` 설치·재시작(관리자 이름·연락처 수정, DB 패치 없음, healthz 200, 직전 릴리스 `ef57636` 보존) |
| 11-26 08:07 | WAS `bara-edu-api` | 변경 | API 릴리스 `d02a4ae` 설치·재시작(개인정보 후속 3건, healthz 200, 직전 릴리스 `3ba761f` 보존) |
| 11-26 08:10 | `bara_edu`(읽기 전용) | 조회 | 패치 전 확인 — 새로 파기 대상이 되는 비회원 진단 행 0건(월별 0), `diagnosis_leads` 소유자 `bara_edu_service`, 정책 select·update 2개. 건수만 조회 |
| 11-26 08:11 | `bara_edu` | 변경 | 패치 `2026-11-26-privacy-followups.sql` 적용(`set local role bara_edu_service`) — `purge_unclaimed_diagnosis_pii` 조건 확대, `diagnosis_leads_admin_update` 정책 제거. COMMIT, 확인: 정책 select 1개만, 함수 갱신됨. 앱 배포(Amplify #68) 뒤 적용 |
| 11-26 08:12 | `bara_edu`(읽기 전용) | 조회 | 리드 메모 개인정보 형태 점검 — 메모 있는 리드 0건, 해당 0건. 건수만 조회 |

## 같은 날 함께 정리한 것

- Amplify 미리보기 브랜치 `feat/app-cutover` 삭제, API `SITE_ORIGINS`에서 미리보기 주소 제거 후 재시작(healthz 200)
- 로컬의 미리보기 basic auth 비밀번호 파일, Supabase CA 임시 파일 삭제
- 남겨 둔 것: 로컬 `~/.config/bara-edu/supabase.env`(0600) — 12/1 Supabase 키 교체·삭제 작업 때까지. RDS 마스터 비밀번호는 Secrets Manager에만 있음
