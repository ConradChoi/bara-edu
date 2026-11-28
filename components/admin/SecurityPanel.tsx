'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { securityStep } from '@/app/actions/admin-security';
import Notice from '@/components/admin/Notice';
import StatusBadge from '@/components/admin/StatusBadge';
import { SetupBody, noticeText } from '@/components/auth/OtpSetupSteps';
import { AlertIcon } from '@/components/error/icons';
import { ADMIN_PRIMARY_BTN, ADMIN_SECONDARY_BTN, ADMIN_TEXT_LINK } from '@/components/error/styles';
import { MFA_COPY as C } from '@/lib/mfa-copy';
import type { SetupView } from '@/lib/mfa-setup-types';

// M4 /admin/security의 상태 카드와 단계(디자인 스펙 T-7). 단계 화면은 같은 카드 안에서 상태 카드를 대체한다(페이지 이동 없음).
// 날짜 문구(등록일·마지막 사용)는 서버가 서울 시각으로 만들어 넘긴다(하이드레이션 차이 없음).

export type SecuritySummary = {
  enrolled: boolean;
  canSelfEnroll: boolean;
  stateText: string;
  recoveryCodesLeft: number;
};

const CARD = 'rounded-lg border border-n-3 bg-n-0 p-5';
const CARD_ACTIVE = 'rounded-lg border-2 border-indigo bg-n-0 p-5';

export default function SecurityPanel({ summary, initial }: { summary: SecuritySummary; initial: SetupView }) {
  const [view, formAction, pending] = useActionState<SetupView, FormData>(securityStep, initial);
  const [first] = useState(view);

  if (view.step !== 'status') {
    return (
      <section className={CARD_ACTIVE}>
        <SetupBody
          view={view}
          formAction={formAction}
          pending={pending}
          size="admin"
          carry={{}}
          recoveryCodesLeft={summary.recoveryCodesLeft}
          focus={view !== first}
          backToStatus
        />
      </section>
    );
  }

  const low = summary.enrolled && summary.recoveryCodesLeft <= 3;
  const notice = view.notice;
  return (
    <section aria-labelledby="sec-title" className={`${CARD} flex flex-col gap-4`}>
      <h2 id="sec-title" className="text-[17px] font-semibold text-n-9">
        {C['MFA-SEC-CARD']}
      </h2>
      {notice && (
        <Notice tone="danger" role="alert">
          <p>{noticeText(notice)}</p>
          {notice.kind === 'already' && <p>{C['MFA-SEC-ALREADY-NOTME']}</p>}
          {notice.kind === 'session_expired' && (
            <Link href="/sign-in?redirect=%2Fadmin%2Fsecurity" className={ADMIN_TEXT_LINK}>
              {C['MFA-LOGIN-ERR-EXPIRED-BTN']}
            </Link>
          )}
        </Notice>
      )}
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3 text-[14px]">
        <dt className="text-n-6">상태</dt>
        <dd className="flex flex-wrap items-center gap-2 text-n-9">
          <StatusBadge tone={summary.enrolled ? 'success' : 'warning'}>
            {summary.enrolled ? C['MFA-RESET-COL-VALUES'].enrolled : C['MFA-RESET-COL-VALUES'].not_enrolled}
          </StatusBadge>
          <span>{summary.stateText}</span>
        </dd>
        {summary.enrolled && (
          <>
            <dt className="text-n-6">복구 코드</dt>
            <dd className="flex items-center gap-2 text-n-9">
              {low && <AlertIcon className="size-4 shrink-0 text-warning-strong" />}
              {(low ? C['MFA-SEC-RC-LOW'] : C['MFA-SEC-RC-COUNT']).replace('{n}', String(summary.recoveryCodesLeft))}
            </dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap gap-4">
        {!summary.enrolled && summary.canSelfEnroll && (
          <form action={formAction}>
            <input type="hidden" name="intent" value="enroll" />
            <button type="submit" className={ADMIN_PRIMARY_BTN}>
              {C['MFA-SEC-BTN-ENROLL']}
            </button>
          </form>
        )}
        {summary.enrolled && (
          <>
            <form action={formAction} className="flex max-w-[360px] flex-col gap-1">
              <input type="hidden" name="intent" value="change" />
              <button type="submit" className={ADMIN_SECONDARY_BTN} aria-describedby="sec-change-help">
                {C['MFA-SEC-BTN-CHANGE']}
              </button>
              <p id="sec-change-help" className="text-[13px] leading-[1.6] text-n-6 break-keep">
                {C['MFA-SEC-BTN-CHANGE-HELP']}
              </p>
            </form>
            <form action={formAction} className="flex max-w-[360px] flex-col gap-1">
              <input type="hidden" name="intent" value="regen" />
              <button type="submit" className={ADMIN_SECONDARY_BTN} aria-describedby="sec-rc-help">
                {C['MFA-SEC-BTN-RC']}
              </button>
              <p id="sec-rc-help" className="text-[13px] leading-[1.6] text-n-6 break-keep">
                {C['MFA-SEC-BTN-RC-HELP']}
              </p>
            </form>
          </>
        )}
      </div>
      <Notice tone="info" role="note">
        <p>{C['MFA-SEC-NOOFF']}</p>
      </Notice>
    </section>
  );
}
