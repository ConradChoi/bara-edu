import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface DatabaseStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  // staging=false(단일 AZ, 백업 1일, 삭제 가능) / prod=true(멀티 AZ, 백업 7일, 삭제 보호)
  // — bin/app.ts에서 stage 컨텍스트로 결정해 넘긴다.
  multiAz: boolean;
}

// Supabase가 관리형으로 제공하던 Postgres를 RDS로 대체한다. Postgres 엔진 자체는
// Supabase도 바닐라 Postgres + 확장(extension) 조합이라 데이터/스키마 이식성은 높다.
export class DatabaseStack extends cdk.Stack {
  public readonly instance: rds.DatabaseInstance;
  // RDS가 자동 생성하는 비밀(username/password/host/port/dbname 포함) — GoTrue/PostgREST/
  // Storage API용 DATABASE_URL은 이 비밀 하나만으로 조합할 수 없다(각 서비스는 완전한
  // 연결 문자열 1개를 원하는데 Secrets Manager는 필드별 참조만 지원) — README "수동/스크립트
  // 단계" 절 참고. services-stack.ts가 참조할 수 있도록 public으로 노출한다.
  public readonly credentialsSecret: secretsmanager.ISecret;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // CloudFormation의 GroupDescription은 영문/숫자/일부 기호만 허용한다(한글 등은 배포
    // 시점에 검증 실패) — 설명은 코드 주석으로 남기고 description은 ASCII로만 쓴다.
    // 인바운드는 ECS 서비스 보안그룹에서만 허용한다(services-stack.ts가 addIngressRule로 추가).
    this.securityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc: props.vpc,
      description: 'bara-edu Supabase self-hosted RDS - inbound only from ECS services',
      allowAllOutbound: false,
    });

    // Postgres 버전: 실제 전환 전 기존 Supabase 프로젝트의 SQL Editor에서
    // `select version();`을 실행해 정확한 버전을 확인하고 이 값을 맞춰야 한다 —
    // 메이저 버전이 다르면 일부 확장(pgjwt, pg_graphql 등)의 동작이 달라질 수 있다.
    // 여기서는 Supabase가 최근까지 기본값으로 써온 15.x를 가정값으로 둔다.
    const engine = rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15_8 });

    const parameterGroup = new rds.ParameterGroup(this, 'ParameterGroup', {
      engine,
      description: 'pg_cron 활성화 — Supabase 관리형에서는 대시보드 토글 한 번이었지만 자체 호스팅은 shared_preload_libraries 설정 + 재부팅이 필요하다',
      parameters: {
        shared_preload_libraries: 'pg_cron',
        'cron.database_name': 'postgres',
      },
    });

    this.instance = new rds.DatabaseInstance(this, 'Instance', {
      engine,
      // db.t4g.micro: 스테이징/리허설용 최소 사이즈. WBS Phase 3(기능 검증)에서 실제 부하를
      // 보고 운영 전환 전 사이징을 재검토한다 — 지금은 "코드만" 단계라 비용 최소값을 기본값으로 둔다.
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MICRO),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [this.securityGroup],
      parameterGroup,
      multiAz: props.multiAz,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(props.multiAz ? 7 : 1),
      deletionProtection: props.multiAz,
      // staging은 cdk destroy로 깨끗이 정리할 수 있어야 리허설을 반복하기 쉽다 — prod는
      // 실수로라도 삭제되면 안 되므로 RETAIN.
      removalPolicy: props.multiAz ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      databaseName: 'postgres',
      credentials: rds.Credentials.fromGeneratedSecret('supabase_admin'),
    });

    this.credentialsSecret = this.instance.secret!;
  }
}
