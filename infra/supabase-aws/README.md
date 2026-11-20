# bara-edu Supabase → AWS 자체 호스팅 (중단됨 — 기록용)

> **2026-11-12부로 진행하지 않는다.** 대표 결정으로 Supabase 소프트웨어를 자체 호스팅하는
> 것도 쓰지 않기로 했고, 일리아 공용 서버(`ylia-pg-01`·`YLIA_WAS_01`)로 옮기는 설계로
> 대체됐다: [`docs/superpowers/specs/2026-11-12-bara-edu-supabase-exit-design.md`](../../docs/superpowers/specs/2026-11-12-bara-edu-supabase-exit-design.md).
> 이 코드는 지우지 않고 참고용으로 남긴다. 2026-10-28 스테이징을 한 번 실제 배포해 세 서비스
> 기동까지 확인한 뒤 `cdk destroy`로 전부 삭제했다 — 현재 이 코드로 만든 AWS 리소스는 없다.
> 앱 빌드에서 제외하려고 루트 `tsconfig.json`의 `exclude`에 `infra`가 들어 있다(빠지면 Amplify 빌드 실패).

현재 `bara-edu-lms`는 Supabase 관리형(무료 플랜)을 DB·Auth·Storage로 쓰고 있다. 회사
전체 서비스를 AWS로 통합하기로 한 결정(2026-10-28, 대표)에 따라, 같은 기능을 AWS
위에서 자체 호스팅하기 위한 CDK 인프라 코드였다.

## 선택한 방향: "Supabase 소프트웨어를 AWS에서 직접 운영"

두 경로를 검토했다(ceo-advisor/developer 합의, 2026-10-27 대화 참고):

- **이 코드가 택한 경로 — AWS 위에 Supabase OSS를 직접 호스팅**: RDS(Postgres) + ECS
  Fargate(GoTrue/PostgREST/Storage API). 앱 코드(`@supabase/supabase-js` 호출, RLS 정책,
  RPC)는 거의 그대로 쓴다 — "관리형 서비스"에서 "같은 소프트웨어를 우리가 운영"으로
  바뀌는 것뿐이다.
- **채택하지 않은 경로 — RDS + Cognito + S3 완전 네이티브 전환**: 인증 모델이 근본적으로
  달라 `lib/supabase/*`, `app/actions/*`의 인증 관련 코드 전체를 재작성해야 하고, 기존
  회원 비밀번호 해시를 Cognito로 이전할 수 없어(강제 비밀번호 재설정 필요) "한 번에
  전환"이라는 목표와 맞지 않는다고 판단해 제외했다.

## 구성

```
infra/supabase-aws/
  bin/app.ts              CDK 앱 진입점 — 서울 리전(ap-northeast-2) 고정, stage 컨텍스트로 staging/prod 분리
  lib/network-stack.ts    VPC (public / private-app / private-db 3계층, NAT 1개)
  lib/database-stack.ts   RDS PostgreSQL (pg_cron 활성화 파라미터 그룹 포함)
  lib/storage-stack.ts    S3 버킷 (Storage API 백엔드, 완전 비공개 + 서명 URL 모델 유지)
  lib/services-stack.ts   ECS Fargate: GoTrue(인증) / PostgREST(REST API) / Storage API, ALB 경로 라우팅
  scripts/generate-jwt-keys.ts  anon/service_role JWT 발급 스크립트
```

> ⚠️ **알려진 문제(2026-10-28 스테이징 배포에서 확인)**: Kong을 생략한 판단이 틀렸다.
> `@supabase/supabase-js`는 `/auth/v1/*`, `/rest/v1/*`, `/storage/v1/*`로 요청하는데,
> ALB는 경로 접두사를 떼어 전달하지 못해 세 서비스 모두 404를 반환한다. 접두사를 제거해
> 주는 게이트웨이(Kong 또는 nginx) 컨테이너를 ALB 뒤에 추가해야 앱이 붙을 수 있다.

## 전제/가정 (배포 전 반드시 확인)

| 항목 | 현재 코드의 가정값 | 확인 방법 |
|---|---|---|
| Postgres 버전 | 15.17 (15.8은 RDS에서 폐기됨) | 기존 Supabase 프로젝트 SQL Editor에서 `select version();` |
| 리전 | ap-northeast-2(서울) | 대표 결정(2026-10-28) — 확정 |
| 커스텀 도메인 | 미정(지금은 ALB 기본 DNS + HTTP 80 포트) | WBS Phase 5에서 확정 후 ACM 인증서 + 443 리스너로 교체 |
| RDS 인스턴스 사이즈 | db.t4g.micro(스테이징 최소값) | WBS Phase 3 부하 확인 후 운영 사이즈 재검토 |
| 이메일 발송(SMTP) | AWS SES(서울 리전) 가정 | SES 발신 도메인 인증 + 샌드박스 해제는 AWS 콘솔/지원 티켓이 필요해 CDK로 자동화 불가 — 대표/운영 담당이 직접 처리해야 함 |

## 배포 후 수동/스크립트 단계 (CDK만으로 끝나지 않는 부분)

연결 문자열 비밀은 CDK가 빈 값으로만 만들기 때문에, 첫 배포는 태스크 0개로 뼈대만 만들고
비밀을 채운 뒤 태스크를 띄운다(2026-10-28 스테이징에서 실제로 수행한 순서).

1. `npx cdk deploy --all -c stage=staging -c desiredCount=0` — 비밀이 비어 있어도 실패하지 않는다.
2. RDS 마스터 비밀(Database 스택의 Secrets Manager 리소스)로 아래 비밀을 채운다.
   - `database-url`: `postgresql://supabase_admin:<pw>@<host>:5432/postgres` (PostgREST — libpq가 SSL 자동 사용)
   - `storage-database-url`: 위 값 + `?sslmode=no-verify` (Storage API의 Node pg는 SSL을 명시해야 함)
   - `gotrue-database-url`: `postgresql://supabase_auth_admin:<새 비밀번호>@<host>:5432/postgres`
3. `JWT_SECRET=<jwt-secret 값> npm run generate-jwt-keys` → 두 JWT를 `anon-key`/`service-role-key`에 입력.
4. `ses-smtp`: SES 준비 전에는 `{"username":"PLACEHOLDER","password":"PLACEHOLDER"}`처럼 **유효한 JSON**이라도
   넣어야 GoTrue가 기동한다(실제 메일 발송은 SES 도메인 인증 + 샌드박스 해제 후).
5. RDS는 격리 서브넷이라 외부에서 접속할 수 없다 — VPC 안에서 `postgres:15` 일회성 ECS 태스크로
   `sql/00-init-supabase-roles.sql`, `sql/01-init-gotrue-role.sql`(psql 변수 `gotrue_pw` = 2번의 비밀번호)을 실행.
6. `npx cdk deploy BaraEduSupabase-Services-staging -c stage=staging`(desiredCount 기본 1).
   ⚠️ 태스크 수만 바뀌는 배포는 ECS circuit breaker가 동작하지 않아, 기동 실패 시 CloudFormation이
   최대 3시간 대기한다 — ECS 로그를 직접 보고 실패면 `aws cloudformation cancel-update-stack`.
7. (미완) `supabase/schema.sql` 적용과 데이터 이관은 Phase 4.

## 명령어

```bash
cd infra/supabase-aws
npm install
npm run synth          # CloudFormation 템플릿만 생성, AWS 호출 없음 — 코드 검증용
npm run diff            # 실제 AWS 계정과 비교(AWS 자격증명 필요)
npm run deploy:staging  # 실제 리소스 생성 — 비용 발생 시작점(WBS Phase 2)
```

## WBS 단계 매핑

| WBS 단계 | 이 저장소에서의 의미 |
|---|---|
| Phase 1 (현재) | 이 디렉터리의 코드 전체 — 비용 0 |
| Phase 2 | `deploy:staging` 실행 + 위 "배포 후 수동 단계" 완료 + schema.sql 적용 |
| Phase 3 | qa-reviewer + privacy-security-officer가 스테이징에서 전체 기능/RLS/권한 재검증 |
| Phase 4 | Supabase → RDS 데이터 이관 스크립트 작성 및 스테이징 리허설(이 저장소에 아직 없음 — 다음 작업) |
| Phase 5 | 커스텀 도메인 + ACM 인증서 연결, SES 프로덕션 액세스, 런북 확정 |
| Phase 6 | `deploy:prod`로 운영 스택 생성 → 데이터 최종 동기화 → bara-edu 앱의 `NEXT_PUBLIC_SUPABASE_URL` 등 환경변수 교체 |

## 비용 추정 (스테이징, 월 대략치 — 서울 리전 온디맨드 기준)

- RDS db.t4g.micro(단일 AZ): 약 $12~15
- NAT Gateway 1개: 약 $32 + 트래픽
- ECS Fargate 3개 서비스(0.25 vCPU/0.5GB 각): 약 $25~30
- ALB: 약 $16 + 트래픽
- S3/Secrets Manager: 수 달러 수준

**스테이징 기준 월 $90~100 내외.** 운영(prod) 전환 시 RDS Multi-AZ·NAT 추가 등으로
증가한다 — 정확한 수치는 Phase 0 "예산 범위" 결정 시 더 다듬어야 한다.
