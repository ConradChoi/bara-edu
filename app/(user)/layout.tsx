import AppHeader from '@/components/layout/AppHeader';

export default function UserLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader kind="user" />
      <main>{children}</main>
    </>
  );
}
