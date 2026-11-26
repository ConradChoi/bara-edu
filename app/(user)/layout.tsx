import AppHeader from '@/components/layout/AppHeader';
import Footer from '@/components/layout/Footer';

export default function UserLayout({ children }: { children: React.ReactNode }) {
  return (
    // 본문이 짧아도 푸터가 화면 맨 아래에 붙도록 세로 flex + main flex-1((auth)·404와 같은 구조).
    <div className="flex min-h-screen flex-col print:block print:min-h-0">
      <AppHeader kind="user" />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
