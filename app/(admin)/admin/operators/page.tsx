import type { Metadata } from 'next';
import Link from 'next/link';
import AdminTable from '@/components/admin/AdminTable';
import StatusBadge from '@/components/admin/StatusBadge';
import { getAdminMembers } from '@/lib/supabase/admin-queries';
import type { ProfileStatus } from '@/lib/types';

export const metadata: Metadata = { title: '운영자 관리 | 관리자' };

const STATUS_LABEL: Record<ProfileStatus, string> = { active: '활동중', withdrawn: '탈퇴' };

// 회원 관리(/admin/members)에 운영자(role='admin')와 일반 회원이 섞여 있던 걸 분리한
// 읽기 전용 화면이다(관리자 요청, 2026-08-25). 권한 부여/해제는 이 화면에서 하지 않으며
// 지금과 동일하게 Supabase 대시보드에서 profiles.role을 직접 바꾸는 방식을 유지한다.
export default async function AdminOperatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  const operators = await getAdminMembers({
    q,
    status: status === 'withdrawn' ? 'withdrawn' : status === 'active' ? 'active' : 'all',
    role: 'admin',
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[20px] font-semibold text-n-9">운영자 관리</h1>
      <p className="text-[12.5px] text-n-6">
        운영자(관리자 권한) 계정 목록이에요. 권한 부여·해제는 Supabase 대시보드에서 처리해요.
      </p>

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
            <th>등록일</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {operators.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-10 text-center text-n-6">
                검색 결과가 없어요
              </td>
            </tr>
          ) : (
            operators.map((m) => (
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
