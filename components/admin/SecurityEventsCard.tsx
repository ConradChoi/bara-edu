import { MFA_COPY as C } from '@/lib/mfa-copy';
import { kstWhen } from '@/lib/mfa-format';
import type { SecurityEvent, SecurityEventKind } from '@/lib/supabase/admin-queries';

// M7 "최근 7일 보안 이벤트" 카드(기획서 3.8). 대시보드(전체 관리자)와 내 보안 설정(내 것만)이 같이 쓴다.
// 한 줄: 일시 · 대상 관리자 이름 · 사건(초기화는 사유) · 알림을 다른 사람에게 못 보냈으면 표시. IP·detail 원문은 없다.

const LABEL: Record<SecurityEventKind, string> = {
  enrolled: C['MFA-EVENT-ENROLLED'],
  reset: C['MFA-EVENT-RESET'],
  ticket: C['MFA-EVENT-TICKET'],
  locked: C['MFA-EVENT-LOCKED'],
  locked_daily: C['MFA-EVENT-LOCKED-DAILY'],
  unlocked: C['MFA-EVENT-UNLOCKED'],
  recovery: C['MFA-EVENT-RECOVERY'],
  pwreset: C['MFA-EVENT-PWRESET'],
};
const REASONS: Record<string, string> = C['MFA-RESET-REASON'];

export default function SecurityEventsCard({ events, showDesc = true, now }: { events: SecurityEvent[] | null; showDesc?: boolean; now?: number }) {
  return (
    <section aria-labelledby="security-events-title" className="rounded-lg border border-n-3 bg-n-0 p-5">
      <h2 id="security-events-title" className="text-[15px] font-semibold text-n-9">
        {C['MFA-EVENT-TITLE']}
      </h2>
      {showDesc && <p className="mt-1 text-[13px] leading-[1.6] text-n-6 break-keep">{C['MFA-EVENT-DESC']}</p>}
      {events === null ? (
        <p role="alert" className="mt-3 text-[14px] text-n-8">
          {C['MFA-EVENT-LOADERR']}
        </p>
      ) : events.length === 0 ? (
        <p className="mt-3 text-[14px] text-n-7">{C['MFA-EVENT-EMPTY']}</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-n-3">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-[14px] text-n-8">
              <span className="tabular-nums text-n-6">{kstWhen(e.at, now)}</span>
              <span className="font-medium text-n-9">{e.targetName ?? '-'}</span>
              <span>
                {LABEL[e.kind]}
                {e.reason && REASONS[e.reason] ? ` (${REASONS[e.reason]})` : ''}
              </span>
              {e.selfOnly && <span className="rounded-pill border border-warning px-2 text-[12px] text-n-9">{C['MFA-EVENT-SELFONLY']}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
