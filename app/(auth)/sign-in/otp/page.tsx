import type { Metadata } from 'next';
import MfaLoginForm from '@/components/auth/MfaLoginForm';
import { readMfaChallenge } from '@/lib/db/session-cookie';
import { carryRedirect } from '@/lib/mfa-redirect';

// M1 로그인 2단계: 인증 앱 6자리(기획서 3.2, 디자인 스펙 T-3). 응답 헤더 no-store·noindex·no-referrer는 next.config.ts.
export const metadata: Metadata = { title: '인증 앱 번호 입력 | 바라 평생교육원', robots: { index: false, follow: false } };

// 대기표 쿠키(bara_mfa)가 없으면 리다이렉트하지 않고 "로그인 시간이 지났어요" 상태 화면(3.1 proxy 규칙).
// 쿠키 값 자체는 화면에 싣지 않는다(httpOnly, 서버 액션이 다시 읽는다).
export default async function SignInOtpPage({ searchParams }: { searchParams: Promise<{ redirect?: string }> }) {
  const { redirect } = await searchParams;
  const hasChallenge = Boolean(await readMfaChallenge());
  return <MfaLoginForm mode="otp" redirectTo={carryRedirect(redirect)} initial={hasChallenge ? undefined : { kind: 'screen', screen: 'expired' }} />;
}
