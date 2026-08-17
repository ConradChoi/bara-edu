import AppHeader from '@/components/layout/AppHeader';
import Footer from '@/components/layout/Footer';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-n-0">
      <AppHeader kind="public" />
      <div className="mx-auto w-full max-w-[440px] flex-1 px-6 py-10">{children}</div>
      <Footer />
    </div>
  );
}
