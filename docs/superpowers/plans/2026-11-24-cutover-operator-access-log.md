# 서버 전환 운영자 접근 기록 (2026-11-23 ~ 11-26, Supabase 삭제 포함)

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
| 11-26 12:33 | Amplify 앱 `d2se60288osxp1` | 변경 | 앱 환경변수 `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY` 삭제(코드 참조 없음 확인), 재빌드 #70 SUCCEED, 주요 화면 200 |
| 11-26 12:55 | Supabase 프로젝트(서울 리전) | 삭제 | 대표가 대시보드에서 프로젝트 통째 삭제 — 데이터(DB)·Storage(사진)·API 키(anon·service_role)·DB 비밀번호가 함께 폐기됨. 대표 결정으로 예정일(12/1)보다 앞당김 |
| 11-26 13:0x | 로컬 | 확인·삭제 | 삭제 확인: 프로젝트 API 주소 DNS 없음(REST·Storage 응답 없음), DB 풀러 접속 시 tenant not found. 로컬 `~/.config/bara-edu/supabase.env` 삭제. Amplify 빌드 캐시는 콘솔에 비우는 기능이 없어 두었음 — 남아 있을 수 있는 옛 키는 프로젝트 삭제로 무효 |
| 11-26 13:51 | `bara_edu` | 변경 | 패치 `2026-11-26-access-log-2y.sql` 적용(`set local role bara_edu_service`) — `purge_old_admin_access_logs` 파기 기준 1년→2년, COMMIT, 소유자 `bara_edu_service` 확인 |
| 11-26 13:52 | WAS `bara-edu-api` | 변경 | API 릴리스 `ec55c08` 설치·재시작(요청 제한 IPv6 /64 묶기, healthz 200, 직전 `d02a4ae` 보존). 앱(문구 2년)은 Amplify #72 |
| 11-26 14:42 | WAS `bara-edu-api` | 변경 | API 릴리스 `6178b38` 설치·재시작(비밀번호 찾기: 재설정 완료 알림 메일, 재설정 성공 시 login-fail 해제, 재설정 제출 IP 제한, DB 패치 없음, healthz 200, 직전 `ec55c08` 보존). 앱은 Amplify #74 SUCCEED 14:45, 주요 화면 200, `/forgot-password`·`/reset-password` 헤더(no-store·noindex, reset은 no-referrer) 확인, API 5xx 0건 |
| 11-26 15:1x | WAS `bara-edu-api` | 변경 | API 릴리스 `76c75fa` 설치·재시작(관리자 계정 메일 링크 재설정을 접속 기록에 남김, IP 형식 검증, DB 패치 없음, healthz 200, 직전 `6178b38` 보존). 앱(오류 안내·링크 크기 등)은 Amplify #76 SUCCEED(ca587fc), 주요 화면 200, API 5xx 0건 |
| 11-26 17:3x | SSM `/bara-edu/api/mfa-key-v1` | 생성 | 관리자 2단계 인증 마스터 키(SecureString, 32바이트 무작위, 값은 화면·로그에 출력하지 않음, 길이만 확인) |
| 11-26 17:3x | IAM `ylia-was-role` 인라인 정책 `bara-edu-api` | 변경 | `ssm:GetParameter` 대상에 `mfa-key-v1` 추가(기존 service-key와 같은 문, 그 외 변경 없음). WAS에서 SDK로 읽기 확인(길이 32) |
| 11-26 17:4x | WAS `/app/bara-edu/shared/api.env` | 변경 | 백업 `api.env.bak-20261126-mfa` 후 `BARA_MFA_KEY_PARAMS`·`BARA_MFA_KEY_CURRENT=1`·`ADMIN_MFA_MODE=optional`·`ADMIN_MFA_GRACE_UNTIL=2026-12-03T21:00+09:00`·`ADMIN_SECURITY_ALERT_TO`(대표 지정 운영 주소) 추가. 옛 API는 읽지 않음(재시작 전 영향 없음) |
| 11-26 17:45 | `bara_edu` | 변경 | 패치 `2026-11-26-admin-mfa.sql` 적용(`set local role bara_edu_service`), COMMIT. auth.mfa_* 8개 테이블, sessions 컬럼 3개, `purge_expired_mfa_rows` 확인(카탈로그 조회). 기존 데이터 변경 없음 |
| 11-26 17:5x | Amplify 앱 | 배포 | main `afc948b`(관리자 2단계 인증 화면, 옛 API와 호환) #77 SUCCEED, 주요 화면 정상, API 5xx 0건. API 릴리스 `afc948b`는 WAS에 빌드만 해 둠(21:00 전환 예정) |
| 11-26 20:35 | WAS `bara-edu-api` | 변경 | 대표 지시로 21:00 대신 즉시 전환: API 릴리스 `afc948b` 설치·재시작(직전 `76c75fa` 보존). 시작 로그 `mfa_mode=optional`, 키 버전 1, `mfa_mode_changed`(지운 관리자 세션 0건), healthz 200, API 5xx 0건. 복구 CLI `admin-mfa mfa-report --operator claude-deploy` 운영 실행 확인(활성 관리자 1명, 미등록) |
| 11-26 20:42 | WAS `/app/bara-edu/shared/api.env`·`bara-edu-api` | 변경 | 대표가 20:40 등록·복구 코드 보관 확인·20:41 6자리 로그인 완료(`mfa-report`로 확인, 같은 IP) → 대표 사전 승인(등록 확인 즉시 필수)에 따라 `ADMIN_MFA_MODE=optional`→`enforce`, 재시작. 시작 로그 `mfa_mode=enforce`, `mfa_mode_changed`(비밀번호만의 관리자 세션 0건 삭제), healthz 200 |
| 11-26 21:4x | `bara_edu` | 조회 | 자가진단 민감정보 동의 배포 전 대표 보고용 건수(읽기 전용 트랜잭션, 값 출력 없음): diagnosis_results 4건(회원 2·비회원 2), answers 120건, 연결된 문의 0건 |
| 11-26 21:4x | AWS RDS·WAS·로컬 | 조회 | 개인정보 점검 M-3: `ylia-pg-01` 자동 백업 보관 7일·저장 암호화 켜짐, 수동 스냅샷 0개(describe만). WAS·로컬에서 덤프·CSV 파일 검색 0건 |
| 11-26 22:01 | `bara_edu` | 변경 | 패치 `2026-11-26-diagnosis-consent.sql` 적용(`begin; set local role bara_edu_service;` 파일 안 `lock_timeout 5s`, COMMIT). 동의 컬럼 4개, 검사 제약(not valid), 함수 4개, diagnosis_results/answers 관리자 select 정책 제거, 비회원 문의 연결 backfill. 카탈로그 조회로 확인 |
| 11-26 22:01 | WAS `bara-edu-api` | 변경 | API 릴리스 `d5528af` 설치·재시작(직전 `afc948b` 보존), healthz 200 |
| 11-26 22:24 | CMS(대표) | 변경 | 대표가 개인정보처리방침 v10 게시. DB에서 v10 게시·v9 비게시, 본문의 B-1·백업 문장 포함을 읽기 전용으로 확인 |
| 11-26 22:24 | GitHub·Amplify 앱 | 배포 | main `6157e56`(민감정보 동의 화면, 오늘 문서 커밋 포함) 푸시, Amplify #78 SUCCEED(22:28). /selfcheck·/selfcheck/start에 동의 안내, /legal/privacy에 v10 확인 |
| 11-26 22:28 | `bara_edu` | 변경(파기) | 정리 스크립트 `2026-11-26-diagnosis-consent-cleanup.sql` 실행(대표 승인 21:5x): NOTICE `results_deleted=4 (member=2, nonmember=2), answers_deleted=120, leads_unlinked=0`. 제약 validate·not null 확인, diagnosis_results 0건. 파기 관리대장 기록 대상. 자동 백업에서는 최대 7일 뒤(12-03경) 사라짐. 배포 후 API 5xx 0건 |
| 11-26 22:43 | GitHub·Amplify 앱 | 배포 | main `e43ecf9`(자가진단 결과 쿠키 경로 `/`) Amplify #79 SUCCEED |
| 11-26 22:57 | GitHub·Amplify 앱 | 배포 | main `56aadb4`(푸터 하단 고정) Amplify #80 SUCCEED. 11-27 대표 화면·인쇄 미리보기 확인 |
| 11-27 11:1x | CloudWatch·WAS·WEB | 조회 | 로그 보관 점검(개인정보 점검 R-8): bara-edu Amplify 로그 그룹 90일, WEB nginx logrotate 14개(약 14일), 두 서버 journald는 용량 200MB만 제한(기간 제한 없음) |
| 11-27 11:17 | WAS·WEB journald (공용) | 변경 | 대표 승인. `/etc/systemd/journald.conf.d/size.conf`에 `MaxRetentionSec=3month` 추가(원본 `size.conf.bak-20261127` 보관), `systemd-journald` 재시작 → active. 적용 직후 WAS 저널 167.7M→113.8M(3개월 넘은 옛 저널 정리). api healthz 200, 홈 200. 같은 서버의 다른 서비스 시스템 로그에도 적용됨 |
| 11-27 12:27 | WAS `bara-edu-api` | 변경 | API 릴리스 `45bb82a` 설치·재시작(직전 `d5528af` 보존): 신규 op `admin.listDiagnosisLeads`, 연락처 가림 강화, 문의 내용 미리보기(대표 결정 R-3 B안). healthz 200 |
| 11-27 12:30 | GitHub·Amplify 앱 | 배포 | main `45bb82a` 푸시, Amplify #81 SUCCEED. 비로그인 `/admin/selfcheck/leads` 307 → /sign-in |
| 11-27 12:30 | `bara_edu` | 변경 | 패치 `2026-11-27-diagnosis-leads-admin-select.sql` 적용(`begin; set local role bara_edu_service;` … commit). 적용 전 정책 `diagnosis_leads_admin_select` 1개 → 적용 후 `pg_policies` 0행, RLS 켜짐 확인(개인정보 점검 R-4 조건). 데이터 변경 없음. 배포 후 API 5xx 0건. 롤백(정책 재생성)은 임시로만 쓴다 |
| 11-27 13:11 | `bara_edu` | 변경 | 패치 `2026-11-27-mfa-enroll-session.sql` 적용(lock_timeout 5s). `auth.mfa_enrollments.session_hash` 추가 확인(pg_attribute: text·null 허용, FK → auth.sessions, on delete cascade). 데이터 변경 없음 |
| 11-27 13:12 | 서버 `ylia-was` | 배포 | API `ec8066c`(2단계 인증 후속: 입구 C 세션 묶기, CLI 보안 알림, 운영 ALERT_TO 필수). 이전 릴리스 `45bb82a` 보관. 재시작 후 active, healthz 200, 홈 200. 배포 전 ADMIN_SECURITY_ALERT_TO 설정됨(1개) 확인 |
| 11-27 13:12 | `bara_edu` | 변경 | 시험 알림: 대표 관리자 계정에 CLI `mfa-unlock --reason owner_locked` 1회(실패 기록 0건 삭제). 접속기록 `2단계인증잠금해제 by=db;…;reason=owner_locked`, `alert=self_only` 없음 → 보안 알림 주소로 발송 계획됨. 수신은 대표가 메일에서 확인함(11-27) |

## 같은 날 함께 정리한 것

- Amplify 미리보기 브랜치 `feat/app-cutover` 삭제, API `SITE_ORIGINS`에서 미리보기 주소 제거 후 재시작(healthz 200)
- 로컬의 미리보기 basic auth 비밀번호 파일, Supabase CA 임시 파일 삭제
- 남겨 둔 것: 로컬 `~/.config/bara-edu/supabase.env`(0600) — 12/1 Supabase 키 교체·삭제 작업 때까지 → 2026-11-26 Supabase 프로젝트 삭제 뒤 삭제함. RDS 마스터 비밀번호는 Secrets Manager에만 있음
