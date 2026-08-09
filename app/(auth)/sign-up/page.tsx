import type { Metadata } from 'next';
import AuthForm from '@/components/auth/AuthForm';

export const metadata: Metadata = { title: '회원가입 | 바라 평생교육원' };

export default function SignUpPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[20px] font-semibold">회원가입</h1>
      <AuthForm mode="signup" />
    </div>
  );
}
