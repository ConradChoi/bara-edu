import type { Metadata } from 'next';
import Link from 'next/link';
import AdminTable from '@/components/admin/AdminTable';
import StatusBadge from '@/components/admin/StatusBadge';
import { getAdminMembers } from '@/lib/supabase/admin-queries';
import type { ProfileStatus } from '@/lib/types';

export const metadata: Metadata = { title: '회원 관리 | 관리자' };

const STATUS_LABEL: Record<ProfileStatus, string> = { active: '활동중', withdrawn: '탈퇴' };

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  const members = await getAdminMembers({ q, status: status === 'withdrawn' ? 'withdrawn' : status === 'active' ? 'active' : 'all' });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[20px] font-semibold text-n-9">회원 관리</h1>

      <form className="flex gap-2" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="이름 또는 이메일 검색"
          className="h-10 flex-1 rounded-md border border-n-3 bg-n-0 px-3 text-[13px]"
        />
        <select
          name="status"
          defaultValue={status ?? 'all'}
          className="h-10 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]"
        >
          <option value="all">전체</option>
          <option value="active">활동중</option>
          <option value="withdrawn">탈퇴</option>
        </select>
        <button type="submit" className="h-10 rounded-pill border border-n-3 px-4 text-[13px] font-medium text-n-7">
          검색
        </button>
      </form>

      <AdminTable>
        <thead>
          <tr>
            <th>이름</th>
            <th>이메일</th>
            <th>연락처</th>
            <th>가입일</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {members.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-10 text-center text-n-6">
                검색 결과가 없어요
              </td>
            </tr>
          ) : (
            members.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link href={`/admin/members/${m.id}`} className="font-medium text-n-9">
                    {m.name}
                  </Link>
                </td>
                <td>{m.email ?? '-'}</td>
                <td>{m.phone ?? '-'}</td>
                <td>{new Date(m.createdAt).toLocaleDateString('ko-KR')}</td>
                <td>
                  <StatusBadge tone={m.status === 'withdrawn' ? 'neutral' : 'success'}>
                    {STATUS_LABEL[m.status]}
                  </StatusBadge>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </AdminTable>
    </div>
  );
}
