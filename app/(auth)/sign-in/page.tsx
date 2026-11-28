import type { Metadata } from 'next';
import AuthForm from '@/components/auth/AuthForm';
import { MFA_COPY } from '@/lib/mfa-copy';

export const metadata: Metadata = { title: '로그인 | 바라 평생교육원' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; reset?: string; ended?: string }>;
}) {
  const { redirect, reset, ended: endedParam } = await searchParams;
  // 관리자 세션 자동 로그아웃 이유(기획서 4.9, 카피 6장). max·idle 외 값은 무시하고 기존 배너를 쓴다.
  const ended = endedParam === 'max' || endedParam === 'idle' ? endedParam : null;
  const fromAdmin = typeof redirect === 'string' && (redirect === '/admin' || redirect.startsWith('/admin/'));

  return (
    <div className="flex flex-col gap-6">
      {ended && (
        <div role="status" className="rounded-md border border-l-4 border-n-3 border-l-warning bg-n-1 px-4 py-3">
          <p className="text-base font-semibold leading-[1.6] text-n-9 break-keep">
            {ended === 'max' ? MFA_COPY['MFA-SESSION-MAX'] : MFA_COPY['MFA-SESSION-IDLE']}
          </p>
          {fromAdmin && <p className="mt-1 text-base leading-[1.6] text-n-8 break-keep">{MFA_COPY['MFA-SESSION-WHY']}</p>}
          <p className="mt-1 text-base leading-[1.6] text-n-8 break-keep">{MFA_COPY['MFA-SESSION-NOTE']}</p>
        </div>
      )}
      {redirect && !ended && (
        <div className="rounded-md border border-warning bg-warning/10 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-warning-strong">세션이 만료되었어요</p>
          <p className="text-[12px] text-n-7">다시 로그인하면 원래 페이지로 돌아가요.</p>
        </div>
      )}
      {reset && (
        // 글자는 n-9/n-8(success 글씨는 대비 미달, P-3). 재설정이 모든 세션을 지우므로 다른 기기 안내를 덧붙인다(RP-SUCCESS).
        <div role="status" className="rounded-md border border-success bg-success/10 px-4 py-3">
          <p className="text-base font-semibold text-n-9">비밀번호가 변경됐어요.</p>
          <p className="text-base leading-[1.6] text-n-8 break-keep">새 비밀번호로 로그인해 주세요. 다른 기기에서는 다시 로그인해야 해요.</p>
        </div>
      )}
      <h1 className="text-[20px] font-semibold">로그인</h1>
      <AuthForm mode="signin" redirectTo={redirect} />
    </div>
  );
}
