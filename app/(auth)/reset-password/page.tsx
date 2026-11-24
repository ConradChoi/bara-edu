import type { Metadata } from 'next';
import ResetPasswordForm from '@/components/auth/ResetPasswordForm';

export const metadata: Metadata = { title: '비밀번호 재설정 | 바라 평생교육원' };

// 재설정 메일 링크는 /reset-password?token= 으로 온다.
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[20px] font-semibold">비밀번호 재설정</h1>
      <ResetPasswordForm token={token} />
    </div>
  );
}
