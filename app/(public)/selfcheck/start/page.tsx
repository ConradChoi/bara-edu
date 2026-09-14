import type { Metadata } from 'next';
import DiagnosisStepper from '@/components/diagnosis/DiagnosisStepper';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: '도형심리 역량진단 | 바라 평생교육원' };

const ERROR_MESSAGE: Record<string, string> = {
  validation: '필수 항목을 확인해주세요.',
  incomplete: '아직 응답하지 않은 문항이 있어요.',
  'submit-failed': '제출에 실패했어요. 잠시 후 다시 시도해주세요.',
};

// F-DIAG-3/4/5. 로그인 상태면 profiles에서 이름/휴대전화/이메일을 프리필한다(수정 가능).
export default async function DiagnosisStartPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let defaultName: string | undefined;
  let defaultPhone: string | undefined;
  let defaultEmail: string | undefined;
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('name, phone, email').eq('id', user.id).maybeSingle();
    defaultName = profile?.name ?? undefined;
    defaultPhone = profile?.phone ?? undefined;
    defaultEmail = profile?.email ?? undefined;
  }

  return (
    <div>
      {error && ERROR_MESSAGE[error] && (
        <div className="mx-auto mt-5 max-w-[520px] rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          {ERROR_MESSAGE[error]}
        </div>
      )}
      <DiagnosisStepper defaultName={defaultName} defaultPhone={defaultPhone} defaultEmail={defaultEmail} />
    </div>
  );
}
