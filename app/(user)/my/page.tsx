import type { Metadata } from 'next';
import Link from 'next/link';
import { changePassword, updateContactInfo, withdraw } from '@/app/actions/account';
import WithdrawForm from '@/components/mypage/WithdrawForm';
import {
  getCompletedEnrollmentsForUser,
  getMyCertificatesWithCourse,
  getProgressStatsForCourses,
} from '@/lib/supabase/classroom-queries';
import { getMyDiagnosisResults } from '@/lib/supabase/diagnosis-queries';
import { getMyEnrollments, type MyEnrollment } from '@/lib/supabase/queries';
import { createClient } from '@/lib/supabase/server';
import type { EnrollmentStatus } from '@/lib/types';
import { DIAGNOSIS_TIER_LABELS, type DiagnosisTier } from '@/data/diagnosis/config';

const SETTINGS_SUCCESS_MESSAGE: Record<string, string> = {
  password: '비밀번호를 변경했어요.',
  contact: '주소·사진 정보를 저장했어요.',
};

const SETTINGS_ERROR_MESSAGE: Record<string, string> = {
  'password-validation': '새 비밀번호는 8자 이상이어야 하고, 확인란과 일치해야 해요.',
  'current-password-wrong': '현재 비밀번호가 일치하지 않아요.',
  'photo-too-large': '사진 용량은 5MB 이하여야 해요.',
  'photo-invalid': '지원하지 않는 이미지 형식이에요 (JPEG/PNG/GIF/WebP만 가능).',
  failed: '처리 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.',
};

export const metadata: Metadata = { title: '마이페이지 | 바라 평생교육원' };

// 대표 요청(2026-09-17)에 따른 메뉴 구성 — "정보수정"에 회원정보 표시·주소/사진 수정·
// 회원탈퇴를 모두 담고, 비밀번호 변경은 별도 메뉴로 분리한다. "자가진단내역"은 이번에
// 새로 생긴 섹션(/selfcheck 결과를 계정에 연결한 이력).
const TABS = [
  { key: 'dashboard', label: '대시보드' },
  { key: 'edit-info', label: '정보수정' },
  { key: 'password', label: '비밀번호 변경' },
  { key: 'applications', label: '신청내역' },
  { key: 'enrollments', label: '수강내역' },
  { key: 'certificates', label: '수료증' },
  { key: 'diagnosis', label: '자가진단내역' },
] as const;

const STATUS_LABEL: Record<EnrollmentStatus, string> = {
  pending: '대기',
  approved: '승인',
  rejected: '반려',
  expired: '만료',
};

const STATUS_TONE: Record<EnrollmentStatus, string> = {
  pending: 'bg-warning/15 text-warning',
  approved: 'bg-success/15 text-success',
  rejected: 'bg-danger/15 text-danger',
  expired: 'bg-n-2 text-n-6',
};

const CARD_LINK_CLASS =
  'rounded-lg border border-n-3 bg-n-0 p-4 transition hover:border-pink/40 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-pink';

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    withdrawError?: string;
    welcome?: string;
    settingsSuccess?: string;
    settingsError?: string;
  }>;
}) {
  const { tab = 'dashboard', withdrawError, welcome, settingsSuccess, settingsError } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // proxy.ts가 비로그인 접근을 이미 차단한다

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, email, phone, address, photo_path')
    .eq('id', user.id)
    .maybeSingle();

  // 대시보드 카드가 신청/수강/수료/자가진단 4개 개수를 전부 보여줘야 해서, 개별 탭에서만
  // 조회하던 방식(이전 버전)을 버리고 항상 함께 가져온다 — 개인 데이터라 목록 규모가
  // 작아 지금 규모에서는 매번 조회해도 부담이 없다(불필요한 최적화를 미리 하지 않음).
  const [enrollments, completed, certificates, diagnosisResults] = await Promise.all([
    getMyEnrollments(user.id),
    getCompletedEnrollmentsForUser(user.id),
    getMyCertificatesWithCourse(user.id),
    getMyDiagnosisResults(),
  ]);
  const inProgress = enrollments.filter((e) => e.status === 'approved');
  const progressStats = await getProgressStatsForCourses(
    user.id,
    inProgress.map((e) => e.courseId)
  );

  return (
    <div className="mx-auto max-w-[800px] px-6 py-10">
      <h1 className="text-[24px] font-semibold text-n-9">마이페이지</h1>

      {welcome === '1' && (
        <div className="mt-4 rounded-md border border-success bg-success/10 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-success">이메일 인증이 완료됐어요. 가입을 환영해요!</p>
        </div>
      )}
      {withdrawError === 'active-enrollment' && (
        <div className="mt-4 rounded-md border border-warning bg-warning/10 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-warning">진행 중인 강좌가 있어 탈퇴할 수 없어요.</p>
          <p className="text-[12px] text-n-7">고객센터로 문의해 주세요.</p>
        </div>
      )}
      {withdrawError === 'failed' && (
        <div className="mt-4 rounded-md border border-danger bg-danger/10 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-danger">탈퇴 처리 중 문제가 발생했어요.</p>
          <p className="text-[12px] text-n-7">잠시 후 다시 시도하거나 고객센터로 문의해 주세요.</p>
        </div>
      )}
      {withdrawError === 'validation' && (
        <div className="mt-4 rounded-md border border-danger bg-danger/10 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-danger">탈퇴 사유를 선택해주세요.</p>
        </div>
      )}
      {settingsSuccess && SETTINGS_SUCCESS_MESSAGE[settingsSuccess] && (
        <div className="mt-4 rounded-md border border-success bg-success/10 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-success">{SETTINGS_SUCCESS_MESSAGE[settingsSuccess]}</p>
        </div>
      )}
      {settingsError && (
        <div className="mt-4 rounded-md border border-danger bg-danger/10 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-danger">
            {SETTINGS_ERROR_MESSAGE[settingsError] ?? SETTINGS_ERROR_MESSAGE.failed}
          </p>
        </div>
      )}

      {/* 메뉴 7개를 좁은 화면에서도 다 보여줘야 해서 가로 스크롤을 허용한다(overflow-x-auto)
          — 기존 4개짜리 탭과 같은 마크업을 그대로 확장했다(신규 사이드바 도입은 이 프로젝트
          공개 화면 어디에도 없던 패턴이라 만들지 않음, 관리자 사이드바는 데스크톱 전용). */}
      <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-n-3">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/my?tab=${t.key}`}
            className={`shrink-0 px-4 py-2.5 text-[13px] font-medium ${
              tab === t.key ? 'border-b-2 border-pink text-pink' : 'text-n-6'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === 'edit-info' ? (
          <EditInfoSection
            name={profile?.name ?? ''}
            email={profile?.email ?? user.email ?? ''}
            phone={profile?.phone ?? null}
            address={profile?.address ?? null}
            hasPhoto={Boolean(profile?.photo_path)}
          />
        ) : tab === 'password' ? (
          <PasswordSection />
        ) : tab === 'enrollments' ? (
          <div className="flex flex-col gap-8">
            <div>
              <p className="mb-3 text-[13px] font-semibold text-n-9">수강 중</p>
              <EnrollmentList
                enrollments={inProgress}
                emptyMessage="수강 중인 강좌가 없어요"
                showStatus={false}
                progressStats={progressStats}
              />
            </div>
            <div>
              <p className="mb-3 text-[13px] font-semibold text-n-9">수강 완료</p>
              {completed.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-n-6">아직 완료한 강좌가 없어요</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {completed.map((c) => (
                    <li key={c.courseId} className="flex items-center justify-between rounded-lg border border-n-3 p-4">
                      <Link href={`/courses/${c.courseSlug}`} className="text-[14px] font-semibold text-n-9">
                        {c.courseTitle}
                      </Link>
                      <Link
                        href={`/learn/${c.courseId}`}
                        className="rounded-pill border border-n-3 px-3 py-1.5 text-[12px] font-medium text-n-7"
                      >
                        다시 보기
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : tab === 'certificates' ? (
          certificates.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-n-6">아직 발급된 수료증이 없어요</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {certificates.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-lg border border-n-3 p-4">
                  <span className="text-[14px] font-semibold text-n-9">{c.courseTitle}</span>
                  <span className="text-[12px] text-n-6">{new Date(c.issuedAt).toLocaleDateString('ko-KR')} 발급</span>
                </li>
              ))}
            </ul>
          )
        ) : tab === 'diagnosis' ? (
          diagnosisResults.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-[13px] text-n-6">아직 자가진단 이력이 없어요</p>
              <Link href="/selfcheck" className="rounded-pill bg-pink px-4 py-2 text-[13px] font-semibold text-white">
                도형심리 역량진단 받아보기
              </Link>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {diagnosisResults.map((d) => (
                <li key={d.accessToken} className="flex items-center justify-between rounded-lg border border-n-3 p-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-[14px] font-semibold text-n-9">{DIAGNOSIS_TIER_LABELS[d.recommendedTier]}</span>
                    <span className="text-[12px] text-n-6">
                      {new Date(d.createdAt).toLocaleDateString('ko-KR')} · {Math.round(d.totalScore)}점
                    </span>
                  </div>
                  <Link
                    href={`/selfcheck/result/${d.accessToken}`}
                    className="rounded-pill border border-n-3 px-3 py-1.5 text-[12px] font-medium text-n-7"
                  >
                    결과 보기
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : tab === 'applications' ? (
          <EnrollmentList enrollments={enrollments} emptyMessage="신청한 강좌가 없어요" showStatus />
        ) : (
          <DashboardSection
            name={profile?.name ?? '회원'}
            pendingCount={enrollments.filter((e) => e.status === 'pending').length}
            inProgressCount={inProgress.length}
            certificateCount={certificates.length}
            latestDiagnosis={diagnosisResults[0] ?? null}
          />
        )}
      </div>

      {tab === 'edit-info' && (
        <div className="mt-10 flex items-center justify-between border-t border-n-3 pt-6">
          <div>
            <p className="text-[13px] font-semibold text-n-9">회원 탈퇴</p>
            <p className="text-[12px] text-n-6">탈퇴 시 개인정보는 즉시 익명화되고 학습 이력은 파기돼요.</p>
          </div>
          <WithdrawForm action={withdraw} />
        </div>
      )}
    </div>
  );
}

function DashboardSection({
  name,
  pendingCount,
  inProgressCount,
  certificateCount,
  latestDiagnosis,
}: {
  name: string;
  pendingCount: number;
  inProgressCount: number;
  certificateCount: number;
  latestDiagnosis: { recommendedTier: DiagnosisTier } | null;
}) {
  const cards = [
    { label: '입금 대기 중인 신청', value: pendingCount, href: '/my?tab=applications' },
    { label: '수강 중인 강좌', value: inProgressCount, href: '/my?tab=enrollments' },
    { label: '발급받은 수료증', value: certificateCount, href: '/my?tab=certificates' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[14px] text-n-7">
        <span className="font-semibold text-n-9">{name}</span>님, 환영해요.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className={CARD_LINK_CLASS}>
            <p className="text-[12px] text-n-6">{c.label}</p>
            <p className="mt-1 text-[24px] font-semibold text-n-9">{c.value}</p>
          </Link>
        ))}
      </div>

      <Link href="/my?tab=diagnosis" className={CARD_LINK_CLASS}>
        <p className="text-[12px] text-n-6">최근 자가진단 결과</p>
        <p className="mt-1 text-[15px] font-semibold text-n-9">
          {latestDiagnosis ? DIAGNOSIS_TIER_LABELS[latestDiagnosis.recommendedTier] : '아직 진단받은 이력이 없어요'}
        </p>
      </Link>
    </div>
  );
}

function EditInfoSection({
  name,
  email,
  phone,
  address,
  hasPhoto,
}: {
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  hasPhoto: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 rounded-lg border border-n-3 p-4">
        <p className="text-[13px] font-semibold text-n-9">회원정보</p>
        <dl className="flex flex-col gap-2 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-n-6">이름</dt>
            <dd className="text-n-9">{name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-n-6">이메일</dt>
            <dd className="text-n-9">{email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-n-6">휴대전화</dt>
            <dd className="text-n-9">{phone ?? '-'}</dd>
          </div>
        </dl>
        <p className="text-[11.5px] text-n-5">이름·이메일·휴대전화 변경은 고객센터로 문의해주세요.</p>
      </div>

      <form action={updateContactInfo} encType="multipart/form-data" className="flex flex-col gap-4 rounded-lg border border-n-3 p-4">
        <p className="text-[13px] font-semibold text-n-9">신청 정보 수정</p>
        <p className="text-[11.5px] text-n-5">수강신청 시 등록한 주소·자격증 발급용 사진이에요. 다음 신청부터 바로 반영돼요.</p>
        <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
          주소
          <input
            name="address"
            defaultValue={address ?? ''}
            placeholder="수강신청 시 등록한 주소"
            className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
          자격증 발급용 사진 {hasPhoto && <span className="text-n-5">(이미 등록됨 — 새로 올리면 교체돼요)</span>}
          <input
            type="file"
            name="photo"
            accept="image/*"
            className="text-[12.5px] text-n-7 file:mr-3 file:rounded-pill file:border file:border-n-3 file:bg-n-0 file:px-3 file:py-1.5 file:text-[12px] file:font-medium"
          />
        </label>
        <button type="submit" className="h-10 self-start rounded-pill bg-pink px-5 text-[13px] font-semibold text-white">
          저장
        </button>
      </form>
    </div>
  );
}

function PasswordSection() {
  return (
    <form action={changePassword} className="flex max-w-[360px] flex-col gap-4 rounded-lg border border-n-3 p-4">
      <p className="text-[13px] font-semibold text-n-9">비밀번호 변경</p>
      <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
        현재 비밀번호 *
        <input
          type="password"
          name="currentPassword"
          required
          className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
        새 비밀번호 *
        <input
          type="password"
          name="newPassword"
          required
          minLength={8}
          placeholder="8자 이상"
          className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[12.5px] text-n-7">
        새 비밀번호 확인 *
        <input
          type="password"
          name="confirmPassword"
          required
          minLength={8}
          className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
        />
      </label>
      <button type="submit" className="h-10 self-start rounded-pill bg-pink px-5 text-[13px] font-semibold text-white">
        변경
      </button>
    </form>
  );
}

function EnrollmentList({
  enrollments,
  emptyMessage,
  showStatus,
  progressStats,
}: {
  enrollments: MyEnrollment[];
  emptyMessage: string;
  showStatus: boolean;
  progressStats?: Record<string, { totalLessons: number; completedLessons: number }>;
}) {
  if (enrollments.length === 0) {
    return <p className="py-10 text-center text-[13px] text-n-6">{emptyMessage}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {enrollments.map((e) => {
        const stat = progressStats?.[e.courseId];
        const ratio = stat && stat.totalLessons > 0 ? Math.round((stat.completedLessons / stat.totalLessons) * 100) : 0;

        return (
          <li key={e.id} className="flex items-center justify-between rounded-lg border border-n-3 p-4">
            <div className="flex flex-col gap-1">
              <Link href={`/courses/${e.courseSlug}`} className="text-[14px] font-semibold text-n-9">
                {e.courseTitle}
              </Link>
              <span className="text-[12px] text-n-6">{e.fee.toLocaleString('ko-KR')}원</span>
              {e.status === 'rejected' && e.rejectionReason && (
                <p className="text-[11.5px] text-danger">사유: {e.rejectionReason}</p>
              )}
              {!showStatus && stat && <span className="text-[11.5px] text-n-6">진도 {ratio}%</span>}
            </div>
            {showStatus ? (
              <span className={`rounded-pill px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONE[e.status]}`}>
                {STATUS_LABEL[e.status]}
              </span>
            ) : (
              <Link
                href={`/learn/${e.courseId}`}
                className="rounded-pill bg-pink px-3 py-1.5 text-[12px] font-medium text-white"
              >
                강의실 입장
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
