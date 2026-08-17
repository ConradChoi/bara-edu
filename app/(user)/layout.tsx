import AppHeader from '@/components/layout/AppHeader';
import Footer from '@/components/layout/Footer';

export default function UserLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader kind="user" />
      <main>{children}</main>
      <Footer />
    </>
  );
}
