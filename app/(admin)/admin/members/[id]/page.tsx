import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { sendPasswordResetEmail } from '@/app/actions/admin-members';
import MemberProfileEditor from '@/components/admin/MemberProfileEditor';
import ProfileEditHistory from '@/components/admin/ProfileEditHistory';
import StatusBadge from '@/components/admin/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { listMemberProfileEditsApi } from '@/lib/db/admin-profile';
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
  // 정보 수정 이력(값 없음). 이 조회는 접속 기록을 남기지 않는다(위 상세 조회 기록에 포함).
  const edits = await listMemberProfileEditsApi(id, 5);

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
      {error === 'password_not_set' && (
        <div className="rounded-md border border-warning bg-warning/10 px-3.5 py-3 text-[13px] font-medium text-n-9">
          비밀번호가 없는 계정은 인증 처리를 할 수 없어요. 비밀번호 재설정 메일을 보내 주세요.
        </div>
      )}
      {error === 'failed' && (
        <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          처리 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.
        </div>
      )}

      <MemberProfileEditor
        member={{
          id: profile.id,
          name: profile.name,
          phone: profile.phone ?? null,
          email: profile.email ?? null,
          address: profile.address ?? null,
          status: profile.status,
          role: profile.role,
          emailConfirmed,
          withdrawnAtLabel: profile.withdrawnAt ? new Date(profile.withdrawnAt).toLocaleDateString('ko-KR') : null,
        }}
        pendingCount={enrollments.filter((e) => e.status === 'pending').length}
        certificateCount={certificates.length}
      />

      {profile.status === 'active' && profile.email && emailConfirmed === false && (
        // 가입을 마무리하지 않은 회원은 비밀번호가 없어 관리자가 대신 인증할 수 없다(대표 결정 5).
        // 있던 "이메일 인증완료 처리" 자리에 이유와 대체 방법을 둔다. 재설정 링크를 쓰면 인증도 함께 끝난다.
        <div
          role="note"
          aria-labelledby="unverified-note-title"
          className="flex max-w-[720px] gap-3 rounded-md border border-n-3 border-l-4 border-l-warning bg-n-1 px-4 py-3 text-[13px] leading-[1.6] text-n-8"
        >
          <svg className="mt-0.5 size-4 shrink-0 text-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          <div className="flex flex-col gap-1">
            <p id="unverified-note-title" className="font-semibold text-n-9">
              가입을 마무리하기 전 회원이에요
            </p>
            <p>
              이 회원은 아직 가입을 마무리하지 않아 비밀번호가 없어요. 인증 처리 대신 [비밀번호 재설정 메일 발송]을 눌러 주세요. 회원이 메일의 링크에서 새 비밀번호를 정하면 가입도 함께 끝나요.
            </p>
            <p className="text-n-6">재설정 메일은 가입 이메일로만 가요. 메일을 받은 사람이 곧 이메일 주인이니, 이름이 달라도 이메일만 확인하고 보내 주세요.</p>
          </div>
        </div>
      )}

      {profile.status === 'active' && profile.email && (
        <div className="flex flex-wrap gap-2">
          <ConfirmDialog
            triggerLabel="비밀번호 재설정 메일 발송"
            triggerClassName={
              emailConfirmed === false
                ? 'rounded-pill bg-indigo px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-arc-1'
                : undefined
            }
            title="비밀번호 재설정 메일을 보낼까요?"
            description={
              emailConfirmed === false
                ? `${profile.email}로 재설정 메일이 발송돼요. 회원이 메일의 링크에서 새 비밀번호를 정하면 가입도 함께 마무리돼요.`
                : `${profile.email}로 재설정 메일이 발송돼요. 회원은 메일의 링크로 새 비밀번호를 설정한 뒤 바로 로그인할 수 있어요.`
            }
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

      <ProfileEditHistory
        key={edits.ok ? `${edits.items.length}-${edits.items[0]?.at ?? ''}` : 'failed'}
        memberId={id}
        initialItems={edits.ok ? edits.items : []}
        initialHasMore={edits.ok ? edits.hasMore : false}
        loadFailed={!edits.ok}
        withdrawn={profile.status === 'withdrawn'}
      />
    </div>
  );
}
