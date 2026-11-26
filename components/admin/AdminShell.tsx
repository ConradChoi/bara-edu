import AdminSidebar from '@/components/admin/AdminSidebar';
import AdminTopbar from '@/components/admin/AdminTopbar';
import MfaBanner from '@/components/admin/MfaBanner';
import type { AdminMfaChrome } from '@/lib/mfa-format';

// mfa: 2단계 인증 배너(M6)·"내 보안 설정" 메뉴. 없으면(조회 전·옛 API) 지금 화면과 같다.
export default function AdminShell({ adminName, mfa, children }: { adminName: string; mfa?: AdminMfaChrome; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-n-1">
      <AdminTopbar adminName={adminName} />
      <div className="flex">
        <AdminSidebar showSecurity={mfa?.showSecurityMenu ?? false} />
        <main className="min-h-[calc(100vh-57px)] flex-1 p-6">
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
