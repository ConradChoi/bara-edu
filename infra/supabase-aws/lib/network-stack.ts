import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

// RDS(Postgres)와 ECS Fargate(GoTrue/PostgREST/Storage API)가 들어갈 VPC.
// 3계층 서브넷 구성: public(ALB) / private-app(ECS, NAT로 아웃바운드) / private-db(RDS, 완전 격리).
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // NAT Gateway를 1개만 둔다 — 가용영역(AZ)마다 1개씩 두는 게 고가용성 기본 권장이지만,
    // AZ 장애 시 NAT 단일 장애점이 되는 리스크보다 이 프로젝트 규모에서 월 비용(NAT
    // Gateway는 1개당 시간당 과금 + 트래픽 과금)을 줄이는 쪽을 택했다(developer 판단,
    // WBS Phase 0 "예산 범위" 결정 전까지의 잠정값) — 운영 전환(prod) 시 natGateways를
    // 올리는 것으로 쉽게 전환 가능하니 이 결정 자체가 되돌리기 어려운 건 아니다.
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private-app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'private-db', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
  }
}
