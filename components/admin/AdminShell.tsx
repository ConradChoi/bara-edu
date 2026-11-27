import AdminSidebar from '@/components/admin/AdminSidebar';
import AdminTopbar from '@/components/admin/AdminTopbar';
import MfaBanner from '@/components/admin/MfaBanner';
import SessionSoonNotice from '@/components/admin/SessionSoonNotice';
import type { AdminMfaChrome } from '@/lib/mfa-format';

// mfa: 2단계 인증 배너(M6)·"내 보안 설정" 메뉴. 없으면(조회 전·옛 API) 지금 화면과 같다.
// sessionEndsInMs: 로그아웃까지 남은 시간(서버 기준). 있으면 10분 전부터 MFA-SESSION-SOON을 2단계 인증 배너 위에 함께 보인다.
export default function AdminShell({ adminName, mfa, sessionEndsInMs, children }: { adminName: string; mfa?: AdminMfaChrome; sessionEndsInMs?: number | null; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-n-1">
      <AdminTopbar adminName={adminName} />
      <div className="flex">
        <AdminSidebar showSecurity={mfa?.showSecurityMenu ?? false} />
        <main className="min-h-[calc(100vh-57px)] flex-1 p-6">
          {sessionEndsInMs != null && sessionEndsInMs > 0 && (
            <div className="mb-6 empty:hidden">
              <SessionSoonNotice endsInMs={sessionEndsInMs} />
            </div>
          )}
          {mfa?.banner && (
            <div className="mb-6">
              <MfaBanner banner={mfa.banner} />
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
