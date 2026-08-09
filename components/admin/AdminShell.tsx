import AdminSidebar from '@/components/admin/AdminSidebar';
import AdminTopbar from '@/components/admin/AdminTopbar';

export default function AdminShell({ adminName, children }: { adminName: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-n-1">
      <AdminTopbar adminName={adminName} />
      <div className="flex">
        <AdminSidebar />
        <main className="min-h-[calc(100vh-57px)] flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
