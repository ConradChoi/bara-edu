import type { Metadata } from 'next';
import { issueCertificate, manualIssueCertificate, reissueCertificate } from '@/app/actions/admin-certificates';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  getAdminCourses,
  getAdminMembers,
  getCertificateEligibleLearners,
  getIssuedCertificates,
} from '@/lib/supabase/admin-queries';

export const metadata: Metadata = { title: '수료 관리 | 관리자' };

const SUCCESS_MESSAGE: Record<string, string> = {
  issued: '수료증을 발급했어요.',
  reissued: '재발급 처리했어요 (발급일이 갱신돼요).',
};
const ERROR_MESSAGE: Record<string, string> = {
  'already-issued': '이미 발급된 수료증이에요.',
  'note-required': '수동 처리 사유를 입력해주세요.',
  failed: '처리 중 문제가 발생했어요.',
};

export default async function AdminCertificatesPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const [eligible, issued, members, courses] = await Promise.all([
    getCertificateEligibleLearners(),
    getIssuedCertificates(),
    getAdminMembers({ status: 'active' }),
    getAdminCourses(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[20px] font-semibold text-n-9">수료 관리</h1>

      {success && SUCCESS_MESSAGE[success] && (
        <div className="rounded-md border border-success bg-success/10 px-3.5 py-3 text-[13px] font-medium text-success">
          {SUCCESS_MESSAGE[success]}
        </div>
      )}
      {error && ERROR_MESSAGE[error] && (
        <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          {ERROR_MESSAGE[error]}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold text-n-9">수료 조건 충족자</h2>
        <p className="text-[12px] text-n-5">
          진도 100% + 과제(있는 경우) 승인 완료 기준. 강의실(module-lms-5) 도입 전까지는 비어있는 게 정상이에요.
        </p>
        {eligible.length === 0 ? (
          <p className="text-[13px] text-n-6">대상자가 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {eligible.map((e) => (
              <li
                key={`${e.userId}-${e.courseId}`}
                className="flex items-center justify-between rounded-lg border border-n-3 p-3 text-[13px]"
              >
                <span>
                  <span className="font-medium text-n-9">{e.userName}</span> · {e.courseTitle}
                </span>
                <ConfirmDialog
                  triggerLabel="발급"
                  title="수료증을 발급할까요?"
                  description={`${e.userName}님에게 "${e.courseTitle}" 수료증을 발급합니다.`}
                  confirmLabel="발급"
                  action={issueCertificate.bind(null, e.userId, e.courseId)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold text-n-9">발급 이력</h2>
        {issued.length === 0 ? (
          <p className="text-[13px] text-n-6">발급된 수료증이 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {issued.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg border border-n-3 p-3 text-[13px]">
                <div className="flex flex-col">
                  <span>
                    <span className="font-medium text-n-9">{c.userName}</span> · {c.courseTitle}
                  </span>
                  <span className="text-[11.5px] text-n-5">
                    {new Date(c.issuedAt).toLocaleDateString('ko-KR')}
                    {c.isManualOverride && ' · 수동 처리'}
                    {c.note && ` (${c.note})`}
                  </span>
                </div>
                <ConfirmDialog
                  triggerLabel="재발급"
                  title="재발급할까요?"
                  description="발급일이 오늘로 갱신돼요. 실제 파일을 다시 만드는 기능은 아직 없어요."
                  confirmLabel="재발급"
                  action={reissueCertificate.bind(null, c.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold text-n-9">수동 수료 처리</h2>
        <p className="text-[12px] text-n-5">오프라인 보강 등 예외 사유로 수료 조건과 무관하게 수료증을 발급합니다.</p>
        <form action={manualIssueCertificate} className="flex flex-col gap-2 rounded-lg border border-n-3 bg-n-1 p-3">
          <div className="grid grid-cols-2 gap-2">
            <select name="userId" required className="h-10 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]">
              <option value="">회원 선택</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.email})
                </option>
              ))}
            </select>
            <select name="courseId" required className="h-10 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]">
              <option value="">강좌 선택</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <textarea
            name="note"
            required
            placeholder="사유를 입력해주세요 (예: 오프라인 보강 인정)"
            className="min-h-[64px] rounded-md border border-n-3 bg-n-0 p-2.5 text-[13px]"
          />
          <button type="submit" className="h-10 self-start rounded-pill bg-pink px-4 text-[13px] font-semibold text-white">
            수동 발급
          </button>
        </form>
      </section>
    </div>
  );
}
