import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { confirmMemberEmail, sendPasswordResetEmail } from '@/app/actions/admin-members';
import StatusBadge from '@/components/admin/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { getAdminMemberDetail, getCourseExamSubmissionHistory } from '@/lib/supabase/admin-queries';
import type { EnrollmentStatus } from '@/lib/types';

export const metadata: Metadata = { title: '회원 상세 | 관리자' };

const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  pending: '대기',
  approved: '승인',
  rejected: '반려',
  expired: '만료',
};

const SUCCESS_MESSAGE: Record<string, string> = {
  'email-confirmed': '이메일 인증을 완료 처리했어요.',
  'reset-email-sent': '비밀번호 재설정 메일을 발송했어요.',
};

export default async function AdminMemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const { success, error } = await searchParams;
  const detail = await getAdminMemberDetail(id);
  if (!detail) notFound();

  const { profile, photoSignedUrl, emailConfirmed, enrollments, certificates } = detail;
  const examSubmissions = await getCourseExamSubmissionHistory({ userId: id });

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-[20px] font-semibold text-n-9">{profile.name}</h1>
        <StatusBadge tone={profile.status === 'withdrawn' ? 'neutral' : 'success'}>
          {profile.status === 'withdrawn' ? '탈퇴' : '활동중'}
        </StatusBadge>
      </div>

      {success && SUCCESS_MESSAGE[success] && (
        <div className="rounded-md border border-success bg-success/10 px-3.5 py-3 text-[13px] font-medium text-success">
          {SUCCESS_MESSAGE[success]}
        </div>
      )}
      {error === 'failed' && (
        <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          처리 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-n-3 bg-n-0 p-4 text-[13px]">
        <div>
          <dt className="text-n-5">이메일</dt>
          <dd className="text-n-9">{profile.email ?? '-'}</dd>
        </div>
        <div>
          <dt className="text-n-5">연락처</dt>
          <dd className="text-n-9">{profile.phone ?? '-'}</dd>
        </div>
        <div>
          <dt className="text-n-5">이메일 인증</dt>
          <dd>
            {emailConfirmed === null ? (
              <span className="text-n-5">확인불가</span>
            ) : (
              <StatusBadge tone={emailConfirmed ? 'success' : 'warning'}>{emailConfirmed ? '인증완료' : '미인증'}</StatusBadge>
            )}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-n-5">주소</dt>
          <dd className="text-n-9">{profile.address ?? '-'}</dd>
        </div>
        {profile.status === 'withdrawn' && (
          <div>
            <dt className="text-n-5">탈퇴일</dt>
            <dd className="text-n-9">{profile.withdrawnAt ? new Date(profile.withdrawnAt).toLocaleDateString('ko-KR') : '-'}</dd>
          </div>
        )}
      </dl>

      {profile.status === 'active' && profile.email && (
        <div className="flex flex-wrap gap-2">
          {emailConfirmed === false && (
            <ConfirmDialog
              triggerLabel="이메일 인증완료 처리"
              title="이메일 인증을 완료 처리할까요?"
              description={`${profile.email}의 인증 메일을 확인하지 못한 회원을 대신 인증 처리합니다.`}
              confirmLabel="완료 처리"
              action={confirmMemberEmail.bind(null, profile.id)}
            />
          )}
          <ConfirmDialog
            triggerLabel="비밀번호 재설정 메일 발송"
            title="비밀번호 재설정 메일을 보낼까요?"
            description={`${profile.email}로 재설정 메일이 발송돼요. 회원은 메일의 링크로 새 비밀번호를 설정한 뒤 바로 로그인할 수 있어요.`}
            confirmLabel="발송"
            action={sendPasswordResetEmail.bind(null, profile.id)}
          />
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold text-n-9">자격증 발급용 사진</h2>
        {photoSignedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 프로젝트 전체에 next/image 미사용 컨벤션, 외부 도메인 설정 불필요한 <img> 유지
          <img
            src={photoSignedUrl}
            alt={`${profile.name}님의 자격증 발급용 사진`}
            className="h-[160px] w-[120px] rounded-md border border-n-3 object-cover"
          />
        ) : (
          <p className="text-[13px] text-n-6">등록된 사진이 없어요.</p>
        )}
      </section>

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

      {examSubmissions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[15px] font-semibold text-n-9">자격시험 응시 이력</h2>
          <ul className="flex flex-col gap-2">
            {examSubmissions.map((s, i) => (
              <li key={`${s.courseId}-${s.attemptNo}-${i}`} className="flex items-center justify-between rounded-lg border border-n-3 p-3 text-[13px]">
                <span className="font-medium text-n-9">{s.courseTitle}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-n-6">
                    {s.score}점 · {new Date(s.submittedAt).toLocaleString('ko-KR')}
                  </span>
                  <StatusBadge tone={s.passed ? 'success' : 'warning'}>{s.passed ? '합격' : '불합격'}</StatusBadge>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

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
