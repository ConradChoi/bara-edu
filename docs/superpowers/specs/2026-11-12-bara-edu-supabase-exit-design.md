# bara-edu Supabase 이탈(일리아 자체 환경 이전) 설계

- 작성일: 2026-11-12
- 상태: 초안 (대표 검토 전)
- 대체 대상: `infra/supabase-aws/` 의 "Supabase OSS를 AWS에서 직접 운영" 구상(2026-10-28). 그 코드는 지우지 않고 더 이상 진행하지 않는다.

## 1. 왜 하는가

- 회사 전체 서비스를 일리아 자체 환경(AWS 서울)으로 통합한다(대표 결정 2026-10-28).
- **Supabase는 관리형·자체 호스팅 모두 쓰지 않는다**(대표, 2026-11-12). GoTrue·PostgREST·Storage API 같은 Supabase 소프트웨어를 우리 서버에서 돌리는 것도 제외.
- 공용 DB 표준은 PostgreSQL, 인스턴스는 `ylia-pg-01`(ADR-0092, ShapeTest 저장소).
- 이전 직후 공통 결제 허브를 **ShapeTest·bara-edu·ylia-book**에 먼저 붙인다(토스페이먼츠, 연말 목표). bara-edu는 이미 운영 중이고, 토스 연동이 끝나면 즉시 결제를 연다. 그래서 이 이전이 결제의 선행 조건이다.

## 2. 목표 / 비목표 / 실패 조건

**목표**
- bara-edu의 모든 기능(회원·강좌·수강·시험·자가진단·관리자·약관)이 Supabase 없이 지금과 같게 동작한다.
- 배포는 계속 AWS Amplify(앱 `d2se60288osxp1`, 브랜치 `main`, 도메인 `bara-edu.kr`).
- 추가 AWS 비용 최소화: 목표 월 약 $1(S3·SES). WAS 증설 없이 가능하면 그렇게 한다.
- 기존 회원이 비밀번호 재설정 없이 그대로 로그인한다(해시 이관이 가능하다는 전제 — §7 확인 1).

**비목표**
- 결제 기능 자체(별도 결제 허브 설계에서 다룬다). 다만 결제 허브가 붙을 자리(서버 간 호출 경로)는 막지 않는다.
- 화면·기능 개편. 이번엔 기능 동등(parity)만.
- 전용 VPC·NAT·ECS·ALB 같은 새 인프라.

**실패 조건(기술적으로 돌아가도 실패)**
- ShapeTest가 멈추거나 느려진다(같은 WAS·같은 DB를 쓰므로).
- 기존 회원이 로그인 못 하거나 데이터(수강·시험·수료증·진단)가 빠진다.
- 권한이 새서 다른 회원 데이터나 개인정보(진단 PII·회원 사진)가 보인다.
- 대표 확인 없이 공용 인프라(DB 파라미터, 서버 사양, nginx, 보안그룹)를 바꾼다.

## 3. 현재 상태 (2026-11-12 확인)

- 앱: Next.js 16.2.7(App Router, `proxy.ts`), `@supabase/ssr`·`@supabase/supabase-js`.
- Supabase 사용: 앱 파일 69개. 대부분 서버 코드(Server Action `app/actions/*` 18개, `lib/supabase/*` 쿼리). 브라우저 쪽은 비밀번호 재설정 2개 컴포넌트(`components/auth/RecoveryRedirect.tsx`, `ResetPasswordForm.tsx`)뿐.
  - 인증 호출 약 47곳(getUser 27, signIn/signUp/signOut/updateUser/reset/resend, admin.listUsers/updateUserById/signOut).
  - RPC 16개, 테이블 약 25개.
  - service_role(RLS 우회) 클라이언트: `lib/supabase/admin.ts`.
- 스키마: `supabase/schema.sql`(2,383줄), RLS 정책 81개, `auth.uid()`·`auth.users` 참조 58곳. `profiles.id`가 `auth.users(id)`를 참조하고 가입 시 트리거로 profiles 생성.
- pg_cron 일일 작업 4개(KST 03:00~03:30): `purge_unverified_signups`, `purge_old_admin_access_logs`, `purge_unclaimed_diagnosis_pii`, `purge_old_diagnosis_leads`.
- Storage: 비공개 버킷 `member-photos` 하나. 업로드·삭제·서명URL 모두 서버 코드 5곳(`app/actions/account.ts`, `app/actions/enrollment.ts`, `lib/supabase/admin-queries.ts`).
- Amplify 환경변수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APPS_SCRIPT_URL`, `NEXT_PUBLIC_IS_OPEN`, `NEXT_PUBLIC_OPEN_DATE`, `NEXT_PUBLIC_SITE_NAME`.

**인프라**
- `ylia-pg-01`: PostgreSQL 18.3, db.t4g.small, 20GB(여유 18.3GB), 비공개, Single-AZ. 보안그룹은 `YLIA_WAS_01` 보안그룹에서만 5432 허용. 파라미터 그룹 `ylia-pg18`: `shared_preload_libraries=pg_stat_statements,pg_tle`(pg_cron 없음, 정적 파라미터).
  - 최근 7일: CPU 최대 38%, 여유 메모리 약 1.0GB, 연결 최대 4.
- `YLIA_WAS_01`: t3.small(2GB), 고정 IP, IntraNet. ShapeTest `webapp:api`(Java, `-Xmx768m`, systemd, 3000 HTTPS). 메모리 실측 수단 없음(CloudWatch 에이전트 없음). 과거 OOM 전례(ShapeTest PR#488).
- `YLIA_WEB_SVR_01`: t3.medium, 고정 IP, DMZ. ShapeTest 프론트(PM2+Nginx)·Jenkins. 4구역 원칙상 **DMZ는 DB 자격증명을 갖지 않는다**.

## 4. 결정된 구조

```
브라우저 ─▶ Amplify(Next.js, bara-edu.kr)
              │  서버 코드(Server Action/SSR)만 API 호출
              ▼  HTTPS
         WEB_SVR_01 nginx  (api 경로 → WAS로 전달, 게이트웨이 역할만)
              ▼
         WAS_01: bara-edu API (Node/TypeScript, 메모리 상한)
              ├─▶ ylia-pg-01 / 데이터베이스 bara_edu (RLS·함수 유지)
              ├─▶ S3 (회원 사진, 비공개)
              └─▶ SES (인증·재설정 메일)
```

| 영역 | 결정 | 누가 정했나 |
|---|---|---|
| Supabase | 완전 제거(자체 호스팅 포함) | 대표 |
| 배포 | Amplify 유지 | 대표 |
| API 언어 | Node(TypeScript) | 대표 |
| 비용 | 최대한 0에 가깝게 | 대표 |
| 이전 방식 | 하루 점검 시간(예: 새벽 1~2시간) 동안 서비스를 닫고 한 번에 전환 | 대표 |
| DB | `ylia-pg-01` 안 별도 데이터베이스 `bara_edu`, 전용 DB 역할 | Claude 판단 |
| 접근 경로 | Amplify 서버 → WEB nginx → WAS API. DB를 외부에 열지 않음 | Claude 판단(§7 확인 2 전제) |
| API 프레임워크 | Fastify | Claude 판단 |
| 권한 | RLS 81개와 DB 함수 유지. API가 트랜잭션마다 `set local role` + 요청 회원 id를 설정하고, `auth.uid()`를 같은 이름의 자체 SQL 함수로 대체 | Claude 판단 |
| 인증 | API가 직접: 이메일+비밀번호(bcrypt), 세션 쿠키(httpOnly, 서버 저장 세션 테이블), 이메일 인증·비밀번호 재설정 토큰 | Claude 판단 |
| `auth.users` | `bara_edu` DB 안 자체 `auth.users`(필요 컬럼만)로 대체해 `profiles` FK·트리거 유지 | Claude 판단 |
| 파일 | S3 비공개 버킷 + 서명 URL(유효 60초, 지금과 동일) | Claude 판단 |
| 메일 | SES(서울) | Claude 판단 |
| 일일 정리 작업 | API 프로세스 안 예약 실행(KST 03:00~03:30, 기존 SQL 함수 호출). 공용 DB 파라미터 변경 없음 | Claude 판단 |
| 프로세스 | systemd + Node, `MemoryMax` 상한(초안 256MB) | Claude 판단 |
| 배포 | WEB_SVR_01 Jenkins 잡 추가(ShapeTest와 같은 방식) | Claude 판단 |

**Amplify ↔ API 사이 인증(Claude 판단)**
- 브라우저는 API를 직접 부르지 않는다. Amplify 서버 코드만 부른다.
- Amplify → API 요청에는 서버 간 비밀키(헤더)와, 로그인한 회원이면 세션 토큰을 함께 보낸다.
- nginx는 bara-edu API 경로만 WAS로 전달한다.
- 호스트명은 `api.bara-edu.kr`(새 하위 도메인), TLS는 WEB_SVR_01 nginx에서 종료(인증서 발급 방식은 ShapeTest 웹서버와 동일하게). WEB→WAS 구간도 HTTPS(4구역 "내부 홉도 HTTPS").
- Amplify의 나가는 IP는 고정이 아니므로 443은 인터넷 전체에 열려 있고(지금 ShapeTest와 같음), bara-edu API 경로는 서버 간 비밀키 + nginx 요청 수 제한으로 막는다.
- Amplify 앱은 서울 리전이라 SSR도 서울에서 실행된다. 그래도 `proxy.ts`가 페이지 이동마다 세션·`profiles`(role/status)를 확인하므로, API의 세션 확인 응답은 가볍게(한 번의 쿼리) 만든다.

**권한 관련 보강(2026-11-12 점검 반영, Claude 판단)**
- `schema.sql`에는 `anon`/`authenticated`에 대한 명시적 grant가 **0건**이다(Supabase 기본 권한에 기대고 있음). 새 DB에서는 테이블·함수별 grant를 직접 작성해야 하고, 이것이 RLS 회귀 테스트의 대상이다.
- API 로그인 역할은 테이블 소유자가 아니어야 한다(소유자는 RLS를 우회). 소유자 역할과 로그인 역할을 분리한다. `security definer` 함수 33개는 소유자 권한으로 실행되므로 소유자 지정에 주의.
- 공용 DB 보호: bara-edu 역할에 연결 수 상한과 `statement_timeout`을 걸어 ShapeTest에 영향이 번지지 않게 한다.
- Supabase Auth가 대신 해주던 것 중 직접 구현할 것: 로그인·가입·메일 재발송 요청 수 제한, 가입 시 "이미 있는 이메일" 노출 방지(지금 코드가 이 동작에 의존), 세션 만료·강제 로그아웃(관리자 기능), 가입 시 `name`/`phone` 메타데이터로 profiles 생성.

**DB 역할 이름(Claude 판단)**
- PostgreSQL 역할은 인스턴스 전체 공유라, 공용 `ylia-pg-01`에 `anon`/`authenticated`/`service_role` 같은 일반 이름은 만들지 않는다. `bara_edu_app`(API 로그인), `bara_edu_anon`, `bara_edu_authenticated`, `bara_edu_service` 처럼 접두어를 붙이고, `schema.sql`의 grant/revoke와 `auth.role() = 'authenticated'` 같은 정책을 그에 맞게 고친다.

## 5. 이전 절차(점검 시간 방식)

1. **사전**: 스테이징성 검증. `bara_edu_staging` DB를 같은 인스턴스에 두고 Amplify 미리보기 브랜치로 전체 기능 확인. 실데이터 복사본으로 리허설 1회 이상.
2. **점검 시작**: `NEXT_PUBLIC_IS_OPEN` 등으로 점검 화면 노출, Supabase 쓰기 중단.
3. **데이터 이관**: Supabase에서 `public` 스키마 데이터 + `auth.users`(id, email, 비밀번호 해시, 이메일 인증 시각, 생성 시각 등) + `member-photos` 객체를 내보내 `bara_edu`·S3로 적재. 건수·체크섬 대조.
4. **전환**: Amplify 환경변수 교체(API 주소·서버 간 비밀키, Supabase 변수 제거) 후 재배포.
5. **확인**: 기존 회원 로그인, 수강·시험·수료증·진단·관리자 화면 스모크 테스트.
6. **점검 해제**. Supabase 프로젝트는 일정 기간 읽기 전용 보관 후 삭제(삭제는 대표가 직접).
7. **되돌리기**: 5에서 실패하면 Amplify 환경변수를 Supabase로 되돌리고 재배포(점검 중 쓰기가 없었으므로 데이터 손실 없음).
8. **점검 해제 후 문제**(대표 결정 2026-11-12): 서비스를 연 뒤에는 Supabase로 되돌리지 않는다. 새 환경에서 빠르게 수정한다. 역방향 이관 도구는 만들지 않는다. Supabase는 참고용 읽기 전용 보관만 한다.

**보충(Claude 판단)**
- **스키마 기준선**: `supabase/schema.sql`이 운영과 같다고 가정하지 않는다. 운영 Supabase DB에서 스키마만 `pg_dump`로 뽑아 파일과 비교하고, 다르면 운영 덤프를 기준으로 삼는다(덤프 접근 정보는 대표가 제공).
- **전환 때 사용자 영향**: 기존 로그인 세션은 모두 끊기고(다시 로그인), 이미 보낸 Supabase 인증·재설정 메일 링크는 무효가 된다. 점검 공지에 "다시 로그인 필요"를 적는다. 메일 인증을 아직 안 한 가입자도 그대로 이관하고, 로그인 시도 때 새 인증 메일을 다시 보낼 수 있게 한다(기존 미인증 정리 작업 규칙은 유지).
- **개인정보처리방침 갱신**: 현재 방침 제5조가 수탁자로 "Supabase, Inc."를 적고 있다(`supabase/seed.sql`, `docs/01-plan/features/bara-edu-lms.legal-privacy.md`). 전환일에 수탁자·보관 위치 문구를 고친 새 버전을 기존 약관 버전 기능으로 게시한다.
- **점검 시간대**: `ylia-pg-01` 유지보수 창(금 02:03~02:33 KST)과 백업 창(매일 03:38~04:08 KST)을 피한다.
- **리허설 데이터**: 실데이터 복사본 리허설은 `bara_edu_staging`에서 하고, 리허설이 끝나면 그날 바로 DB와 S3 복사본을 삭제한다. 삭제 사실을 기록에 남긴다.

## 6. 비용 (추정, 서울 온디맨드)

| 항목 | 월 |
|---|---|
| WAS 증설 없음(§7 확인 3 통과 시) | $0 |
| S3 회원 사진 | $1 미만 |
| SES 메일 | 거의 $0(1,000통 $0.1) |
| ylia-pg-01 추가 | $0(같은 인스턴스) |
| **합계** | **약 $1** |

- 확인 3에서 메모리가 부족하면 WAS t3.small → t3.medium **+$19/월**이 선택지다. 증설 여부는 대표가 검토 후 결정한다.

## 7. 착수 전 확인(결과에 따라 설계가 바뀜)

1. **비밀번호 해시 형식**: Supabase는 `auth.users.encrypted_password`에 bcrypt 해시를 저장한다(여러 이관 가이드로 확인, 2026-11-12). 이관 때 해시 접두어(`$2a$`/`$2b$`)를 전수 확인하고, 아닌 계정만 "다음 로그인 때 재설정"으로 처리.
2. **Amplify SSR은 VPC에 직접 붙지 못한다**(AWS 문서·re:Post 기준 확인, 2026-11-12 — 공식 우회는 VPC 안 Lambda 경유). 따라서 §4의 API 경유 구조가 맞다.
3. **WAS 메모리 실측**: CloudWatch 에이전트 설치(대표 승인 필요) 후 며칠 관측. ShapeTest 피크 + 여유가 512MB 이상이면 증설 없이 진행. 부족하면 자동으로 증설하지 않는다 — 실측 결과를 대표에게 보고하고, 대표가 검토 후 증설 여부를 정한다(대표 결정 2026-11-12). 그동안 실측과 무관한 작업(API 개발·스테이징 검증)은 병행한다.
4. **PostgreSQL 15 → 18 호환성**: `schema.sql`이 18.3에서 그대로 적용되는지 스테이징에서 확인. Supabase 전용 확장·스키마(`storage`, `extensions`, `auth` 함수) 참조는 제거/대체.
5. **SES**: 발신 도메인(`bara-edu.kr`) 인증과 샌드박스 해제(대표가 콘솔에서 직접). 2026-11-12 현재 SES에 등록된 것은 `ylia.io`·`jhc@ylia.io`뿐이고 `bara-edu.kr`은 없다. 샌드박스 여부는 읽기 권한이 없어 미확인. Route53에 `bara-edu.kr` 호스팅 영역은 있다.
6. **Amplify 서버 런타임 환경변수**: Amplify는 콘솔 환경변수를 Next.js 서버 런타임에 기본으로 넘기지 않는다(AWS 문서). 현재 빌드 설정(콘솔 buildSpec·`amplify.yml`)은 `.env.production`에 값을 쓰지 않는다. 그래서 (a) **지금 운영에서 `SUPABASE_SERVICE_ROLE_KEY`를 쓰는 관리자 기능 4개 파일이 실제로 동작하는지 먼저 확인**하고(미확인 — 동작한다면 전달 경로를 파악), (b) 새 구조의 "서버 간 비밀키"를 런타임에 어떻게 넘길지 정한다. 초안(Claude 판단): 빌드 때 `.env.production`에 쓰는 AWS 문서 방식. 단 빌드 산출물에 비밀이 남는다는 AWS 경고가 있어, 키는 bara-edu API 전용·주기적 교체로 한다. 대안은 Amplify 컴퓨트 역할 + Parameter Store 조회.

## 8. 공용 인프라 변경 목록(각각 대표 확인 후 실행)

- `ylia-pg-01`: 데이터베이스 `bara_edu`(+스테이징) 생성, 접두어 붙인 역할 4개 생성. **파라미터 그룹·재부팅 없음.**
- `YLIA_WAS_01`: Node 런타임 설치, systemd 서비스 추가, CloudWatch 에이전트 설치.
- `YLIA_WEB_SVR_01`: nginx에 `api.bara-edu.kr` 서버 블록·인증서 추가, Jenkins 잡 추가.
- 보안그룹: 변경 없음(2026-11-12 확인 — WAS 보안그룹은 이미 WEB 보안그룹에서 오는 전 포트를 허용).
- IAM: `ylia-was-role`에 bara-edu S3 버킷·SES 발신 권한 추가.
- DNS: `api.bara-edu.kr` 레코드 추가.
- S3 버킷, SES 도메인, IAM(Amplify 또는 API용) 생성.
- Amplify 환경변수 교체.

## 9. 빌더에게 맡기는 것

- API 엔드포인트 설계와 파일 구성, Server Action에서 부르는 방식(얇은 클라이언트 모듈 하나로 `lib/supabase/*` 대체).
- DB 접속 라이브러리, 마이그레이션 도구, 세션 저장 방식의 세부.
- 테스트 구성(단, RLS 권한 회귀 테스트와 기존 회원 로그인 테스트는 필수).
- 이관 스크립트 구현.
