import type { Metadata } from 'next';
import ResetPasswordForm from '@/components/auth/ResetPasswordForm';

export const metadata: Metadata = { title: '비밀번호 재설정 | 바라 평생교육원' };

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[20px] font-semibold">비밀번호 재설정</h1>
      <ResetPasswordForm />
    </div>
  );
}
