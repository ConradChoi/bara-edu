import type { Metadata } from 'next';
import ResetPasswordForm from '@/components/auth/ResetPasswordForm';

export const metadata: Metadata = { title: '비밀번호 재설정 | 바라 평생교육원' };

// ResetPasswordForm은 URL 해시(#access_token=...)에서 세션을 만드는 요청별 플로우라
// 정적으로 프리렌더링할 이유가 없다. 강제로 dynamic 처리하지 않으면 빌드 시점에 서버에서
// 한 번 더 렌더링되면서 createClient()가 실행되는데, 그 시점에 NEXT_PUBLIC_SUPABASE_*
// 환경변수가 없으면(예: Amplify에서 아직 등록 전) 이 페이지 하나 때문에 빌드 전체가
// 실패했다(2026-08-09, Amplify 첫 배포 시 실제 발생).
export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[20px] font-semibold">비밀번호 재설정</h1>
      <ResetPasswordForm />
    </div>
  );
}
