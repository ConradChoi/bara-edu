import Link from 'next/link';
import { logout } from '@/app/actions/auth';

export default function AdminTopbar({ adminName }: { adminName: string }) {
  return (
    <header className="flex h-[57px] items-center gap-4 border-b border-n-3 bg-n-0 px-6">
      <Link href="/admin" className="text-sm font-semibold text-indigo">
        바라 평생교육원 관리자
      </Link>
      <div className="flex-1" />
      <Link href="/" className="text-[12.5px] text-n-6">
        사이트로 이동
      </Link>
      <span className="text-[12.5px] text-n-6">{adminName}</span>
      <form action={logout}>
        <button type="submit" className="text-[12.5px] text-n-6">
          로그아웃
        </button>
      </form>
    </header>
  );
}
