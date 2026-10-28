import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';

export interface StorageStackProps extends cdk.StackProps {
  stage: string;
}

// Supabase Storage API(자체 호스팅)가 쓰는 백엔드 버킷. 기존 Supabase의 member-photos
// 버킷과 동일하게 '완전 비공개 + 서명 URL로만 접근'하는 모델을 유지한다 —
// lib/supabase/admin-queries.ts의 createSignedUrl() 호출부가 이 전제를 그대로 쓰므로,
// 여기서 공개 읽기를 켜면 자격증 사진 같은 민감 정보가 공개 URL로 노출된다.
export class StorageStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, 'StorageBucket', {
      bucketName: `bara-edu-supabase-storage-${props.stage}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: props.stage === 'prod',
      removalPolicy: props.stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.stage !== 'prod',
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          // TODO(커트오버 전 필수): '*' 대신 실제 서비스 도메인(https://bara-edu.kr)으로 제한.
          // 지금은 스테이징 리허설 단계라 와일드카드로 둔다.
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });
  }
}
