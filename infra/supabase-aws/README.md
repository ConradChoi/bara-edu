# bara-edu Supabase → AWS 자체 호스팅 (WBS Phase 1 산출물)

현재 `bara-edu-lms`는 Supabase 관리형(무료 플랜)을 DB·Auth·Storage로 쓰고 있다. 회사
전체 서비스를 AWS로 통합하기로 한 결정(2026-10-28, 대표)에 따라, 같은 기능을 AWS
위에서 자체 호스팅하기 위한 CDK 인프라 코드다.

**지금 이 코드는 아직 아무 AWS 리소스도 만들지 않았다.** `cdk deploy`를 실행하기 전까지는
비용이 전혀 발생하지 않는다 — WBS Phase 1(코드 작성)까지만 완료된 상태다.

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

Supabase 관리형이 내부적으로 쓰는 **Kong API Gateway는 의도적으로 생략**했다 — 이 앱은
Realtime·Edge Functions·Kong 플러그인을 쓰지 않아서, ALB 경로 규칙(`/auth/*`, `/rest/*`,
`/storage/*`)만으로 충분하다고 판단했다. WBS Phase 3 검증 때 이 생략이 실제로 기능
손실이 없는지 qa-reviewer가 재확인해야 한다.

## 전제/가정 (배포 전 반드시 확인)

| 항목 | 현재 코드의 가정값 | 확인 방법 |
|---|---|---|
| Postgres 버전 | 15.8 | 기존 Supabase 프로젝트 SQL Editor에서 `select version();` |
| 리전 | ap-northeast-2(서울) | 대표 결정(2026-10-28) — 확정 |
| 커스텀 도메인 | 미정(지금은 ALB 기본 DNS + HTTP 80 포트) | WBS Phase 5에서 확정 후 ACM 인증서 + 443 리스너로 교체 |
| RDS 인스턴스 사이즈 | db.t4g.micro(스테이징 최소값) | WBS Phase 3 부하 확인 후 운영 사이즈 재검토 |
| 이메일 발송(SMTP) | AWS SES(서울 리전) 가정 | SES 발신 도메인 인증 + 샌드박스 해제는 AWS 콘솔/지원 티켓이 필요해 CDK로 자동화 불가 — 대표/운영 담당이 직접 처리해야 함 |

## 배포 후 수동/스크립트 단계 (CDK만으로 끝나지 않는 부분)

Secrets Manager는 "비밀 하나 = 값 하나"만 지원해서, GoTrue/PostgREST가 요구하는
"완전한 연결 문자열 1개"(`DATABASE_URL`)를 CDK가 자동으로 조합해 줄 수 없다. 아래
순서대로 한 번만 채워 넣으면 된다.

1. `cdk deploy --all -c stage=staging` 실행 → RDS·S3·ECS(아직 기동 실패 상태)·빈
   비밀 4개(`database-url`, `anon-key`, `service-role-key`, `ses-smtp`)가 생성됨.
2. RDS가 자동 생성한 마스터 비밀(`BaraEduSupabase-Database-staging` 스택 출력의 시크릿)에서
   host/port/username/password를 확인해 `postgresql://<user>:<password>@<host>:5432/postgres`
   형태로 조합 → `bara-edu-supabase/staging/database-url` 비밀 값으로 입력.
3. 같은 `jwt-secret` 값을 `JWT_SECRET` 환경변수로 넘겨 `npm run generate-jwt-keys` 실행 →
   출력된 두 JWT를 각각 `anon-key`/`service-role-key` 비밀에 입력.
4. SES에서 발신 도메인(`bara-edu.kr`) 인증 + SMTP 자격증명 발급 → `ses-smtp` 비밀에
   `{"username":"...","password":"..."}` 형태로 입력. (SES는 기본적으로 샌드박스
   상태라 실제 수신자에게 발송하려면 AWS 지원 티켓으로 프로덕션 액세스를 요청해야 한다 —
   이 프로젝트에 지금까지 이메일 발송 인프라가 전혀 없었다는 점 참고.)
5. ECS 서비스를 강제 재배포(콘솔의 "Force new deployment" 또는
   `aws ecs update-service --force-new-deployment`)해 새 비밀 값을 반영.
6. `supabase/schema.sql`을 새 RDS 인스턴스에 적용 — 기존과 동일한 파일을 그대로 쓰되,
   `auth`/`storage` 스키마와 `anon`/`authenticated`/`service_role` DB 롤은 Supabase가
   관리형에서 자동으로 만들어주던 것이라 자체 호스팅에서는 별도 초기화 스크립트가
   필요하다(Supabase 공식 self-host 저장소의 `docker/volumes/db/*.sql` 초기화 스크립트
   참고 — 이 작업은 WBS Phase 2에서 별도로 준비).

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
