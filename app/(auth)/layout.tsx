import AppHeader from '@/components/layout/AppHeader';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-n-0">
      <AppHeader kind="public" />
      <div className="mx-auto w-full max-w-[440px] px-6 py-10">{children}</div>
    </div>
  );
}
