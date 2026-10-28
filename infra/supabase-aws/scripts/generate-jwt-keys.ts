// services-stack.ts가 만든 JwtSecret 값으로 anon/service_role 두 JWT를 발급한다.
// 이 두 값이 각각 앱의 NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY를
// 대체한다 — Supabase 관리형에서 발급해주던 것과 똑같은 모양(role 클레임이 담긴 JWT)의
// 키를 우리가 직접 서명해서 만드는 것뿐이다.
//
// 사용법(배포 후, WBS Phase 2):
//   JWT_SECRET=<Secrets Manager의 jwt-secret 값> npx ts-node scripts/generate-jwt-keys.ts
// 출력된 두 값을 각각 AWS Secrets Manager의
//   bara-edu-supabase/<stage>/anon-key, bara-edu-supabase/<stage>/service-role-key
// 에 넣는다(콘솔에서 직접, 또는 aws secretsmanager put-secret-value).
//
// 만료(exp)를 일부러 아주 길게(10년) 잡았다 — Supabase 관리형이 발급하는 anon/service_role
// 키도 "장기 키"라는 전제로 이 프로젝트 코드 전역(NEXT_PUBLIC_SUPABASE_ANON_KEY 등)에
// 하드코딩되어 쓰이므로, 짧은 만료는 오히려 서비스가 조용히 끊기는 원인이 된다.
import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error('JWT_SECRET 환경변수가 필요합니다. (Secrets Manager의 jwt-secret 값)');
  process.exit(1);
}

const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60;
const now = Math.floor(Date.now() / 1000);

function issue(role: 'anon' | 'service_role'): string {
  return jwt.sign(
    {
      role,
      iss: 'supabase',
      iat: now,
      exp: now + TEN_YEARS_SECONDS,
    },
    secret as string,
    { algorithm: 'HS256' }
  );
}

console.log('ANON_KEY (NEXT_PUBLIC_SUPABASE_ANON_KEY 대체):');
console.log(issue('anon'));
console.log();
console.log('SERVICE_ROLE_KEY (SUPABASE_SERVICE_ROLE_KEY 대체 — 절대 클라이언트에 노출 금지):');
console.log(issue('service_role'));
