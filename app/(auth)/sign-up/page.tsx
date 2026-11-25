import type { Metadata } from 'next';
import AuthForm from '@/components/auth/AuthForm';
import { LIMITS } from '@/lib/form-messages';

export const metadata: Metadata = { title: '회원가입 | 바라 평생교육원' };

// ?email= 은 가입 마무리 화면의 "처음부터 다시 가입하기"가 넘기는 값이다(이메일만 채우고 나머지는 비운다).
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ email?: string | string[] }> }) {
  const { email } = await searchParams;
  const defaultEmail = typeof email === 'string' && email.length <= LIMITS.email ? email : undefined;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[20px] font-semibold">회원가입</h1>
      <AuthForm mode="signup" defaultEmail={defaultEmail} />
    </div>
  );
}
