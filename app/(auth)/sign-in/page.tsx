import type { Metadata } from 'next';
import AuthForm from '@/components/auth/AuthForm';
import ResendConfirmationForm from '@/components/auth/ResendConfirmationForm';

export const metadata: Metadata = { title: '로그인 | 바라 평생교육원' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; resetSuccess?: string; resetError?: string; confirmError?: string }>;
}) {
  const { redirect, resetSuccess, resetError, confirmError } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      {redirect && (
        <div className="rounded-md border border-warning bg-warning/10 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-warning">세션이 만료되었어요</p>
          <p className="text-[12px] text-n-7">다시 로그인하면 원래 페이지로 돌아가요.</p>
        </div>
      )}
      {resetSuccess && (
        <div className="rounded-md border border-success bg-success/10 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-success">비밀번호가 변경됐어요</p>
          <p className="text-[12px] text-n-7">새 비밀번호로 로그인해주세요.</p>
        </div>
      )}
      {resetError && (
        <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-danger">비밀번호 재설정 링크가 만료됐어요</p>
          <p className="text-[12px] text-n-7">재설정 이메일을 다시 요청해주세요. 링크는 한 번만, 짧은 시간 안에 사용해야 해요.</p>
        </div>
      )}
      {confirmError && (
        <div className="flex flex-col gap-3 rounded-md border border-danger bg-danger/10 px-3.5 py-3">
          <div>
            <p className="text-[13px] font-semibold text-danger">가입 인증 링크가 만료됐거나 이미 사용됐어요</p>
            <p className="text-[12px] text-n-7">아래에 가입한 이메일을 입력하면 인증 메일을 다시 보내드려요.</p>
          </div>
          <ResendConfirmationForm />
        </div>
      )}
      <h1 className="text-[20px] font-semibold">로그인</h1>
      <AuthForm mode="signin" redirectTo={redirect} />
    </div>
  );
}
