#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { StorageStack } from '../lib/storage-stack';
import { ServicesStack } from '../lib/services-stack';

const app = new cdk.App();

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-northeast-2' }; // 서울 리전 고정(대표 결정, 2026-10-28)

// 운영(prod)과 리허설(staging)을 cdk context로 구분한다: `cdk deploy --all -c stage=staging`.
// 기본값은 staging이다 — WBS Phase 2(스테이징 구축)가 먼저이고, prod는 Phase 6(커트오버)
// 직전까지 만들 필요가 없다.
const stage = (app.node.tryGetContext('stage') as string) ?? 'staging';
const isProd = stage === 'prod';

const tags = { project: 'bara-edu-supabase-aws', stage };

const network = new NetworkStack(app, `BaraEduSupabase-Network-${stage}`, { env, tags });
const database = new DatabaseStack(app, `BaraEduSupabase-Database-${stage}`, {
  env,
  tags,
  vpc: network.vpc,
  multiAz: isProd,
});
const storage = new StorageStack(app, `BaraEduSupabase-Storage-${stage}`, { env, tags, stage });

// 최초 배포는 시크릿이 빈 상태라 `-c desiredCount=0`으로 서비스 뼈대만 만들고, 시크릿을
// 채운 뒤 desiredCount 없이(기본값 1) 재배포해 실제 태스크를 띄운다.
const desiredCount = Number(app.node.tryGetContext('desiredCount') ?? 1);

new ServicesStack(app, `BaraEduSupabase-Services-${stage}`, {
  env,
  tags,
  vpc: network.vpc,
  database,
  storageBucket: storage.bucket,
  stage,
  desiredCount,
});
