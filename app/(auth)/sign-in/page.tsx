import type { Metadata } from 'next';
import AuthForm from '@/components/auth/AuthForm';

export const metadata: Metadata = { title: '로그인 | 바라 평생교육원' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; reset?: string }>;
}) {
  const { redirect, reset } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      {redirect && (
        <div className="rounded-md border border-warning bg-warning/10 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-warning">세션이 만료되었어요</p>
          <p className="text-[12px] text-n-7">다시 로그인하면 원래 페이지로 돌아가요.</p>
        </div>
      )}
      {reset && (
        <div className="rounded-md border border-success bg-success/10 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-success">비밀번호가 변경됐어요</p>
          <p className="text-[12px] text-n-7">새 비밀번호로 로그인해 주세요.</p>
        </div>
      )}
      <h1 className="text-[20px] font-semibold">로그인</h1>
      <AuthForm mode="signin" redirectTo={redirect} />
    </div>
  );
}
