import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { DatabaseStack } from './database-stack';

export interface ServicesStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  database: DatabaseStack;
  storageBucket: s3.Bucket;
  stage: string;
}

// Supabase 자체 호스팅의 핵심 3개 컴포넌트(GoTrue=인증, PostgREST=REST API, Storage API=
// 파일 저장)를 ECS Fargate로 띄우고 ALB 경로 라우팅으로 묶는다.
//
// Supabase 관리형이 내부적으로 쓰는 Kong API Gateway는 의도적으로 생략했다 — 이 앱은
// Realtime, Edge Functions, Kong의 rate-limit/로깅 플러그인을 쓰지 않고 경로 라우팅 +
// JWT 검증만 있으면 되는데, 그건 ALB 경로 규칙(아래) + 각 서비스 자체의 JWT 검증으로
// 충분하다. 컨테이너 하나(Kong)를 추가로 운영·패치하지 않아도 되는 단순화다 — qa-reviewer가
// WBS Phase 3 검증 때 "Kong 없이도 @supabase/supabase-js가 기대하는 경로 전부가 똑같이
// 동작하는지"를 반드시 확인해야 한다(특히 PGRST_DB_SCHEMAS에 들어가는 storage/graphql_public
// 스키마 노출 범위 — Kong이 하던 경로별 접근 제한을 ALB 규칙이 동등하게 대체하는지).
//
// *** 이 스택만으로는 서비스가 바로 기동하지 않는다 *** — DATABASE_URL/ANON_KEY/SERVICE_KEY
// 3개 비밀은 빈 플레이스홀더로 생성되고, 실제 값은 배포 후 스크립트로 채워 넣어야 한다
// (README "배포 후 수동/스크립트 단계" 참고). RDS가 만드는 비밀 하나로는 host/port/user/
// password가 각각 흩어진 필드라 GoTrue/PostgREST가 요구하는 "완전한 연결 문자열 1개"를
// CDK만으로 조합할 수 없기 때문이다(Secrets Manager는 필드 단위 참조만 지원).
export class ServicesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ServicesStackProps) {
    super(scope, id, props);

    const { vpc, database, storageBucket, stage } = props;

    // GoTrue/PostgREST/Storage API가 공유하는 JWT 서명 키. 이 값으로 anon/service_role
    // 두 JWT를 직접 발급해야 앱의 NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY를
    // 대체할 수 있다 — `npm run generate-jwt-keys` 스크립트 참고.
    const jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      secretName: `bara-edu-supabase/${stage}/jwt-secret`,
      generateSecretString: { excludePunctuation: true, passwordLength: 40 },
    });

    // 플레이스홀더 3종 — 배포 후 README 절차대로 실제 값을 채워 넣기 전까지는 서비스가
    // 기동하지 않는다(의도된 동작: 비밀 상태로 자동 기동되는 것보다 명시적으로 막혀있는
    // 편이 안전하다).
    const databaseUrlSecret = new secretsmanager.Secret(this, 'DatabaseUrlSecret', {
      secretName: `bara-edu-supabase/${stage}/database-url`,
      description: 'postgresql://<user>:<password>@<rds-endpoint>:5432/postgres 형식 — 배포 후 수동으로 채워야 함',
    });
    const anonKeySecret = new secretsmanager.Secret(this, 'AnonKeySecret', {
      secretName: `bara-edu-supabase/${stage}/anon-key`,
      description: 'generate-jwt-keys 스크립트로 발급한 anon JWT — NEXT_PUBLIC_SUPABASE_ANON_KEY 대체값',
    });
    const serviceKeySecret = new secretsmanager.Secret(this, 'ServiceKeySecret', {
      secretName: `bara-edu-supabase/${stage}/service-role-key`,
      description: 'generate-jwt-keys 스크립트로 발급한 service_role JWT — SUPABASE_SERVICE_ROLE_KEY 대체값',
    });
    // SES SMTP 자격증명 — GoTrue가 가입 인증/비밀번호 재설정 메일을 보내려면 필요하다.
    // Supabase 관리형에서는 이 부분을 대신 처리해줬지만, 자체 호스팅에서는 직접 SMTP를
    // 붙여야 한다(이번 전환으로 새로 생기는 요구사항 — WBS Phase 5에서 SES 도메인 인증까지
    // 끝낸 뒤 이 비밀을 채운다).
    const sesSmtpSecret = new secretsmanager.Secret(this, 'SesSmtpSecret', {
      secretName: `bara-edu-supabase/${stage}/ses-smtp`,
      description: '{"username":"...","password":"..."} 형식의 SES SMTP 자격증명 — SES 도메인 인증 완료 후 채워야 함',
    });

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, containerInsights: stage === 'prod' });

    // database-stack.ts와 동일한 이유로 ASCII 설명만 쓴다(CloudFormation GroupDescription 제약).
    const serviceSg = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc,
      description: 'bara-edu Supabase self-hosted - GoTrue/PostgREST/Storage API shared security group',
    });
    database.securityGroup.addIngressRule(serviceSg, ec2.Port.tcp(5432), 'ECS 서비스에서 RDS 접근 허용');

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/bara-edu-supabase/${stage}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', { vpc, internetFacing: true });
    // TODO(WBS Phase 5, 커트오버 전 필수): ACM 인증서 + 커스텀 도메인을 붙여 443 리스너로
    // 바꾼다. 도메인이 아직 미정이라 지금은 80 포트로만 synth가 통과하게 해 둔다 — 이
    // 리스너를 평문 그대로 운영에 쓰면 안 된다(JWT가 헤더로 오가므로 HTTPS 필수).
    const listener = alb.addListener('HttpListener', { port: 80, open: true });
    listener.addAction('default-404', {
      action: elbv2.ListenerAction.fixedResponse(404, { contentType: 'text/plain', messageBody: 'not found' }),
    });

    // ---- GoTrue (인증) ----
    const gotrue = new FargateHttpService(this, 'GoTrue', {
      cluster,
      serviceSg,
      logGroup,
      image: 'supabase/gotrue:v2.158.1', // 배포 전 최신 안정 태그로 재확인
      containerPort: 9999,
      healthCheckPath: '/health',
      cpu: 256,
      memoryLimitMiB: 512,
      environment: {
        GOTRUE_API_HOST: '0.0.0.0',
        GOTRUE_API_PORT: '9999',
        GOTRUE_DB_DRIVER: 'postgres',
        // TODO(Phase 5): bara-edu.kr 확정 도메인으로 교체.
        GOTRUE_SITE_URL: 'https://bara-edu.kr',
        GOTRUE_URI_ALLOW_LIST: 'https://bara-edu.kr/**',
        GOTRUE_DISABLE_SIGNUP: 'false',
        GOTRUE_JWT_EXP: '3600',
        GOTRUE_JWT_AUD: 'authenticated',
        GOTRUE_JWT_ADMIN_ROLES: 'service_role',
        GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
        GOTRUE_MAILER_AUTOCONFIRM: 'false',
        GOTRUE_SMTP_HOST: 'email-smtp.ap-northeast-2.amazonaws.com',
        GOTRUE_SMTP_PORT: '587',
        GOTRUE_SMTP_ADMIN_EMAIL: 'no-reply@bara-edu.kr', // TODO(Phase 5): SES 인증된 발신 주소로 교체
        GOTRUE_SMTP_SENDER_NAME: '바라 평생교육원',
      },
      secrets: {
        DATABASE_URL: databaseUrlSecret,
        GOTRUE_JWT_SECRET: jwtSecret,
      },
      jsonFieldSecrets: {
        GOTRUE_SMTP_USER: { secret: sesSmtpSecret, field: 'username' },
        GOTRUE_SMTP_PASS: { secret: sesSmtpSecret, field: 'password' },
      },
    });

    // ---- PostgREST (REST API) ----
    const postgrest = new FargateHttpService(this, 'PostgREST', {
      cluster,
      serviceSg,
      logGroup,
      image: 'postgrest/postgrest:v12.2.0',
      containerPort: 3000,
      healthCheckPath: '/',
      cpu: 256,
      memoryLimitMiB: 512,
      environment: {
        PGRST_DB_SCHEMAS: 'public',
        PGRST_DB_ANON_ROLE: 'anon',
        PGRST_DB_USE_LEGACY_GUCS: 'false',
      },
      secrets: {
        PGRST_DB_URI: databaseUrlSecret,
        PGRST_JWT_SECRET: jwtSecret,
      },
    });

    // ---- Storage API (파일 저장, S3 백엔드) ----
    const storageApi = new FargateHttpService(this, 'StorageApi', {
      cluster,
      serviceSg,
      logGroup,
      image: 'supabase/storage-api:v1.11.13',
      containerPort: 5000,
      healthCheckPath: '/status',
      cpu: 256,
      memoryLimitMiB: 512,
      environment: {
        STORAGE_BACKEND: 's3',
        GLOBAL_S3_BUCKET: storageBucket.bucketName,
        REGION: this.region,
        FILE_SIZE_LIMIT: '52428800', // 기존 member-photos 업로드 제한(5MB)보다 넉넉하게 — 앱 레벨 제한은 유지
        TENANT_ID: 'bara-edu',
      },
      secrets: {
        DATABASE_URL: databaseUrlSecret,
        ANON_KEY: anonKeySecret,
        SERVICE_KEY: serviceKeySecret,
        PGRST_JWT_SECRET: jwtSecret,
      },
    });
    storageBucket.grantReadWrite(storageApi.taskDefinition.taskRole);

    // ---- ALB 경로 라우팅 — @supabase/supabase-js가 기대하는 경로 그대로 매핑 ----
    listener.addAction('auth-route', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/auth/*'])],
      action: elbv2.ListenerAction.forward([gotrue.targetGroup]),
    });
    listener.addAction('rest-route', {
      priority: 20,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/rest/*'])],
      action: elbv2.ListenerAction.forward([postgrest.targetGroup]),
    });
    listener.addAction('storage-route', {
      priority: 30,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/storage/*'])],
      action: elbv2.ListenerAction.forward([storageApi.targetGroup]),
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', { value: `http://${alb.loadBalancerDnsName}` });
    new cdk.CfnOutput(this, 'DatabaseUrlSecretArn', { value: databaseUrlSecret.secretArn });
    new cdk.CfnOutput(this, 'AnonKeySecretArn', { value: anonKeySecret.secretArn });
    new cdk.CfnOutput(this, 'ServiceKeySecretArn', { value: serviceKeySecret.secretArn });
    new cdk.CfnOutput(this, 'JwtSecretArn', { value: jwtSecret.secretArn });
  }
}

interface JsonFieldSecretRef {
  secret: secretsmanager.ISecret;
  field: string;
}

interface FargateHttpServiceProps {
  cluster: ecs.Cluster;
  serviceSg: ec2.SecurityGroup;
  logGroup: logs.LogGroup;
  image: string;
  containerPort: number;
  healthCheckPath: string;
  cpu: number;
  memoryLimitMiB: number;
  environment?: Record<string, string>;
  // 전체 비밀 문자열을 그대로 env var 값으로 매핑(예: DATABASE_URL 전체).
  secrets?: Record<string, secretsmanager.ISecret>;
  // 비밀의 특정 JSON 필드 하나만 매핑(예: {"username":"...","password":"..."} 중 username만).
  jsonFieldSecrets?: Record<string, JsonFieldSecretRef>;
}

// GoTrue/PostgREST/Storage API 셋 다 "컨테이너 1개 + Fargate 서비스 + ALB 타깃그룹"이라는
// 동일한 모양이라 반복을 피하려고 작은 헬퍼 construct로 뺐다 — 이 프로젝트 컨벤션(불필요한
// 추상화 지양)에 비춰도, 완전히 같은 패턴이 3번 반복되는 경우라 헬퍼로 묶는 쪽이 더 낫다고
// 판단했다(세 서비스 중 하나만 설정이 달라져도 나머지 둘과 다르게 끌고 가기 쉬워지는 걸 방지).
class FargateHttpService extends Construct {
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: FargateHttpServiceProps) {
    super(scope, id);

    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: props.cpu,
      memoryLimitMiB: props.memoryLimitMiB,
    });

    const secrets: Record<string, ecs.Secret> = {};
    for (const [key, secret] of Object.entries(props.secrets ?? {})) {
      secrets[key] = ecs.Secret.fromSecretsManager(secret);
    }
    for (const [key, ref] of Object.entries(props.jsonFieldSecrets ?? {})) {
      secrets[key] = ecs.Secret.fromSecretsManager(ref.secret, ref.field);
    }

    const container = this.taskDefinition.addContainer('Container', {
      image: ecs.ContainerImage.fromRegistry(props.image),
      environment: props.environment,
      secrets,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: id, logGroup: props.logGroup }),
    });
    container.addPortMappings({ containerPort: props.containerPort });

    const service = new ecs.FargateService(this, 'Service', {
      cluster: props.cluster,
      taskDefinition: this.taskDefinition,
      desiredCount: 1,
      securityGroups: [props.serviceSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      // Docker Hub 이미지를 쓰므로(ECR 아님) private 서브넷이라도 NAT를 통한 아웃바운드가
      // 필요하다 — network-stack.ts의 private-app 서브넷(PRIVATE_WITH_EGRESS)에 배치된다.
      // circuitBreaker 없이는 태스크가 계속 실패할 때 최대 3시간까지 재시도만 반복한다
      // (cdk synth 경고로 발견) — "배포 후 수동 단계"를 깜빡 잊고 바로 deploy했을 때처럼
      // 비밀값이 비어 있어 기동 실패하는 상황이 거의 확실히 있을 거라, 빨리 실패하고
      // 알려주는 쪽이 낫다.
      circuitBreaker: { enable: true, rollback: true },
    });

    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc: props.cluster.vpc,
      port: props.containerPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: { path: props.healthCheckPath, healthyHttpCodes: '200-399' },
      targets: [service],
    });
  }
}
