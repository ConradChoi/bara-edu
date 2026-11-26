import type { Metadata } from 'next';
import OtpSetupFlow from '@/components/auth/OtpSetupSteps';
import { getMfaStatus } from '@/lib/db/mfa';
import { readMfaChallenge } from '@/lib/db/session-cookie';
import { initialEnrollView } from '@/lib/mfa-setup';
import { carryRedirect } from '@/lib/mfa-redirect';
import type { SetupView } from '@/lib/mfa-setup-types';

// M3 2단계 인증 등록, 로그인 중(입구 B: 앱 준비 → 등록 코드 → QR → 복구 코드). 기획서 3.4·4.4, 디자인 스펙 T-5.
// ?reason=reset이면 다시 등록 문구(MFA-REENROLL-*). 화면 선택일 뿐 비밀이 아니다. 응답 헤더 no-store·noindex는 next.config.ts.
export const metadata: Metadata = { title: '2단계 인증 등록 | 바라 평생교육원', robots: { index: false, follow: false } };

export default async function OtpSetupPage({ searchParams }: { searchParams: Promise<{ redirect?: string; reason?: string }> }) {
  const { redirect, reason } = await searchParams;
  const challenge = await readMfaChallenge();
  let initial: Exclude<SetupView, { step: 'status' }>;
  if (challenge) {
    // 새로고침: 서버가 기억하는 단계(같은 QR 또는 [QR 새로 만들기], 등록 코드 확인 전이면 앱 준비)
    const v = await initialEnrollView(challenge);
    initial = v.step === 'status' ? { step: 'prep', entry: 'B' } : v;
  } else {
    // 대기표가 없다: 방금 등록을 마치고(세션 있음) 복구 코드 화면을 새로고침했거나, 대기표가 만료됐다(3.4 마지막 행)
    const status = await getMfaStatus();
    initial = status.ok && status.status.enrolled ? { step: 'end', screen: 'reload' } : { step: 'end', screen: 'expired' };
  }
  return <OtpSetupFlow initial={initial} redirectTo={carryRedirect(redirect)} reset={reason === 'reset'} />;
}
