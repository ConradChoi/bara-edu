import { redirect } from 'next/navigation';
import AdminShell from '@/components/admin/AdminShell';
import { getMfaStatus } from '@/lib/db/mfa';
import { createClient } from '@/lib/db/server';
import { adminMfaChrome, adminSessionEndsInMs } from '@/lib/mfa-format';

// role='admin' 검증은 proxy.ts가 이미 수행하지만, 서버
// 액션마다 requireAdminClient()로 재검증하게 만든 것과 같은 이유로 레이아웃 자체도
// 단일 방어선(미들웨어)에만 기대지 않고 재확인한다 — 미들웨어가 어떤 이유로든(라우트
// 변경, 호스팅 환경의 미들웨어 실행 방식 차이 등) 우회되면 일반 회원도 관리자 화면
// 껍데기를 렌더링할 수 있었다(security-officer 점검, 2026-08-09).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: profile } = await supabase.from('profiles').select('name, role').eq('id', user.id).single();
  if (profile?.role !== 'admin') redirect('/');

  // 2단계 인증 상태는 화면마다 한 번(배너·메뉴). 실패해도 관리자 화면은 그대로 그린다.
  const mfaStatus = await getMfaStatus().catch(() => ({ ok: false as const, reason: 'failed' }));
  const mfa = adminMfaChrome(mfaStatus);
  // 로그아웃 10분 전 안내(MFA-SESSION-SOON)용 남은 시간. 조회 실패·옛 API면 없음(안내 없음).
  const sessionEndsInMs = adminSessionEndsInMs(mfaStatus);

  return (
    <AdminShell adminName={profile?.name ?? '관리자'} mfa={mfa} sessionEndsInMs={sessionEndsInMs}>
      {children}
    </AdminShell>
  );
}
