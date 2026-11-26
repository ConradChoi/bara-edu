import type { Metadata } from 'next';
import Notice from '@/components/admin/Notice';
import SecurityEventsCard from '@/components/admin/SecurityEventsCard';
import SecurityPanel, { type SecuritySummary } from '@/components/admin/SecurityPanel';
import { getMfaStatus, type MfaStatus } from '@/lib/db/mfa';
import { createClient } from '@/lib/db/server';
import { MFA_COPY as C, MFA_COPY_PENDING_REVIEW as P, fill } from '@/lib/mfa-copy';
import { kstLongDate, kstMonthDay, kstWhen } from '@/lib/mfa-format';
import type { SetupView } from '@/lib/mfa-setup-types';
import { getAdminSecurityEvents } from '@/lib/supabase/admin-queries';

// M4 내 보안 설정(기획서 3.5, 디자인 스펙 T-7). 응답 헤더 no-store·noindex·no-referrer는 next.config.ts.
// ?start=enroll|change|recovery-codes: 배너(M6) 버튼이 바로 그 흐름을 연다. 화면 선택일 뿐 비밀이 아니다.
export const metadata: Metadata = { title: '내 보안 설정 | 관리자', robots: { index: false, follow: false } };

function stateText(s: MfaStatus): string {
  if (s.enrolled) return fill(C['MFA-SEC-STATE-ON'], { date: kstLongDate(s.enrolledAt), at: kstWhen(s.lastUsedAt) });
  return s.graceUntil ? fill(C['MFA-SEC-STATE-OFF'], { date: kstMonthDay(s.graceUntil) }) : C['MFA-RESET-STATE-OFF'];
}

function initialView(s: MfaStatus, start: string | undefined): SetupView {
  if (start === 'enroll' && !s.enrolled && s.canSelfEnroll) return { step: 'prep', entry: 'A' };
  // 복구 코드로 로그인한 세션이면 휴대폰이 없을 가능성이 크다 — 복구 코드 칸으로 시작(남아 있을 때만, 3.4)
  if (start === 'change' && s.enrolled) return { step: 'recheck', purpose: 'change', mode: s.signedInWithRecovery && s.recoveryCodesLeft > 0 ? 'rc' : 'otp' };
  if (start === 'recovery-codes' && s.enrolled) return { step: 'recheck', purpose: 'regen', mode: 'otp' };
  return { step: 'status' };
}

export default async function AdminSecurityPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start } = await searchParams;
  const supabase = await createClient();
  const [st, me] = await Promise.all([getMfaStatus(), supabase.auth.getUser()]);
  const userId = me.data.user?.id;
  const events = st.ok && userId ? await getAdminSecurityEvents({ onlyUserId: userId }) : null;

  let body: React.ReactNode;
  if (!st.ok && st.reason === 'unsupported') {
    // 옛 API와 함께 도는 동안(배포 순서 앱 → DB → API, 7.1): 준비 중(ux-writer 검수 대상 문구)
    body = (
      <section className="rounded-lg border border-n-3 bg-n-0 p-5">
        <h2 className="text-[17px] font-semibold text-n-9">{P['APP-MFA-NOT-READY-TITLE']}</h2>
        <p className="mt-2 text-[14px] leading-[1.7] text-n-7">{P['APP-MFA-NOT-READY-BODY']}</p>
      </section>
    );
  } else if (!st.ok) {
    body = (
      <section className="rounded-lg border border-n-3 bg-n-0 p-5">
        <h2 className="mb-3 text-[17px] font-semibold text-n-9">{C['MFA-SEC-CARD']}</h2>
        <Notice tone="danger" role="alert">
          <p>{st.reason === 'unauthenticated' ? C['MFA-RESET-ERR-401'] : C['MFA-SEC-LOADERR']}</p>
        </Notice>
      </section>
    );
  } else {
    const summary: SecuritySummary = {
      enrolled: st.status.enrolled,
      canSelfEnroll: st.status.canSelfEnroll,
      stateText: stateText(st.status),
      recoveryCodesLeft: st.status.recoveryCodesLeft,
    };
    body = (
      <>
        <SecurityPanel summary={summary} initial={initialView(st.status, start)} />
        <SecurityEventsCard events={events} showDesc={false} />
      </>
    );
  }

  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <h1 className="text-[20px] font-semibold text-n-9">{C['MFA-SEC-TITLE']}</h1>
      {body}
    </div>
  );
}
