import type { Metadata } from 'next';
import MfaLoginForm from '@/components/auth/MfaLoginForm';
import { readMfaChallenge } from '@/lib/db/session-cookie';
import { carryRedirect } from '@/lib/mfa-redirect';

// M2 로그인 2단계: 복구 코드(기획서 3.3, 디자인 스펙 T-4). 응답 헤더 no-store·noindex·no-referrer는 next.config.ts.
export const metadata: Metadata = { title: '복구 코드로 로그인 | 바라 평생교육원', robots: { index: false, follow: false } };

// 대기표 쿠키(bara_mfa)가 없으면 리다이렉트하지 않고 "로그인 시간이 지났어요" 상태 화면(3.1 proxy 규칙).
// 쿠키 값 자체는 화면에 싣지 않는다(httpOnly, 서버 액션이 다시 읽는다).
export default async function SignInRecoveryPage({ searchParams }: { searchParams: Promise<{ redirect?: string }> }) {
  const { redirect } = await searchParams;
  const hasChallenge = Boolean(await readMfaChallenge());
  return <MfaLoginForm mode="recovery" redirectTo={carryRedirect(redirect)} initial={hasChallenge ? undefined : { kind: 'screen', screen: 'expired' }} />;
}
