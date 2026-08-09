import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import StatusBadge from '@/components/admin/StatusBadge';
import { getAdminMemberDetail } from '@/lib/supabase/admin-queries';
import type { EnrollmentStatus } from '@/lib/types';

export const metadata: Metadata = { title: '회원 상세 | 관리자' };

const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  pending: '대기',
  approved: '승인',
  rejected: '반려',
  expired: '만료',
};

export default async function AdminMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getAdminMemberDetail(id);
  if (!detail) notFound();

  const { profile, enrollments, certificates } = detail;

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-[20px] font-semibold text-n-9">{profile.name}</h1>
        <StatusBadge tone={profile.status === 'withdrawn' ? 'neutral' : 'success'}>
          {profile.status === 'withdrawn' ? '탈퇴' : '활동중'}
        </StatusBadge>
      </div>

      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-n-3 bg-n-0 p-4 text-[13px]">
        <div>
          <dt className="text-n-5">이메일</dt>
          <dd className="text-n-9">{profile.email ?? '-'}</dd>
        </div>
        <div>
          <dt className="text-n-5">연락처</dt>
          <dd className="text-n-9">{profile.phone ?? '-'}</dd>
        </div>
        {profile.status === 'withdrawn' && (
          <div>
            <dt className="text-n-5">탈퇴일</dt>
            <dd className="text-n-9">{profile.withdrawnAt ? new Date(profile.withdrawnAt).toLocaleDateString('ko-KR') : '-'}</dd>
          </div>
        )}
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold text-n-9">신청 내역</h2>
        {enrollments.length === 0 ? (
          <p className="text-[13px] text-n-6">신청 내역이 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {enrollments.map((e) => (
              <li key={e.id} className="flex items-center justify-between rounded-lg border border-n-3 p-3 text-[13px]">
                <span className="font-medium text-n-9">{e.courseTitle}</span>
                <StatusBadge
                  tone={e.status === 'approved' ? 'success' : e.status === 'rejected' ? 'danger' : e.status === 'expired' ? 'neutral' : 'warning'}
                >
                  {ENROLLMENT_STATUS_LABEL[e.status]}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold text-n-9">수료 이력</h2>
        {certificates.length === 0 ? (
          <p className="text-[13px] text-n-6">수료 이력이 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {certificates.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg border border-n-3 p-3 text-[13px]">
                <div className="flex flex-col">
                  <span className="font-medium text-n-9">{c.courseTitle}</span>
                  {c.isManualOverride && c.note && <span className="text-[11.5px] text-n-5">수동 처리: {c.note}</span>}
                </div>
                <span className="text-n-6">{new Date(c.issuedAt).toLocaleDateString('ko-KR')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
