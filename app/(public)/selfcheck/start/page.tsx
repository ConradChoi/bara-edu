import type { Metadata } from 'next';
import DiagnosisStepper from '@/components/diagnosis/DiagnosisStepper';
import { isSubmitErrorCode } from '@/data/diagnosis/consent-copy';
import { createClient } from '@/lib/db/server';

export const metadata: Metadata = { title: '도형심리 역량진단 | 바라 평생교육원' };

// F-DIAG-3/4/5. 로그인 상태면 profiles에서 이름/휴대전화/이메일을 프리필한다(수정 가능). 동의 체크는 프리필하지 않는다.
// 제출 오류(?error=, 문구 SC-ERR-*)는 스테퍼가 1페이지 위에 그린다: consent-outdated의 "입력한 답은 그대로예요"는
// 브라우저 초안이 있을 때만 붙여야 해서 클라이언트에서 판단한다. consent=privacy|sensitive는 포커스할 체크박스다.
export default async function DiagnosisStartPage({ searchParams }: { searchParams: Promise<{ error?: string; consent?: string }> }) {
  const { error, consent } = await searchParams;
  const serverError = isSubmitErrorCode(error) ? error : undefined;
  const serverConsent = consent === 'privacy' || consent === 'sensitive' ? consent : undefined;

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
      <DiagnosisStepper
        // 같은 화면에서 다른 오류로 다시 돌아오면 초기 오류 상태를 새로 잡도록 다시 마운트한다.
        key={`${serverError ?? ''}:${serverConsent ?? ''}`}
        defaultName={defaultName}
        defaultPhone={defaultPhone}
        defaultEmail={defaultEmail}
        serverError={serverError}
        serverConsent={serverConsent}
      />
    </div>
  );
}
