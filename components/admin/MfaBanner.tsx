import Link from 'next/link';
import Notice from '@/components/admin/Notice';
import { ADMIN_PRIMARY_BTN, ADMIN_SECONDARY_BTN } from '@/components/error/styles';
import { MFA_COPY as C, fill } from '@/lib/mfa-copy';
import type { MfaBanner as Banner } from '@/lib/mfa-format';

// M6 관리자 화면 상단 배너(기획서 3.7, 디자인 스펙 T-9.4). 한 번에 하나, 닫기 없음, role=status(포커스 이동 없음).
// 버튼은 /admin/security로 가서 해당 흐름을 바로 시작한다(?start=는 화면 선택일 뿐 비밀이 아니다).

const GRACE_SR = C['MFA-BANNER-GRACE-SR'].split('{')[0];

function graceText(days: number | null): string {
  if (days === null || days <= 0) return C['MFA-BANNER-GRACE-0'];
  if (days === 1) return C['MFA-BANNER-GRACE-1'];
  return fill(C['MFA-BANNER-GRACE-N'], { N: days });
}

export default function MfaBanner({ banner }: { banner: Banner }) {
  switch (banner.kind) {
    case 'mode_off':
      return (
        <Notice tone="danger" role="status">
          <p>{C['MFA-BANNER-MODE-OFF']}</p>
        </Notice>
      );
    case 'recovery_zero':
      return (
        <Notice tone="danger" role="status">
          <p>{C['MFA-REC-DONE-ZERO']}</p>
        </Notice>
      );
    case 'recovery_used':
      return (
        <Notice tone="warning" role="status">
          <p>{fill(C['MFA-REC-DONE'], { n: banner.left })}</p>
          <div className="mt-2">
            <Link href="/admin/security?start=change" className={ADMIN_PRIMARY_BTN}>
              {C['MFA-REC-DONE-BTN']}
            </Link>
          </div>
        </Notice>
      );
    case 'grace':
      return (
        <Notice tone="info" role="status">
          <p>
            <span className="sr-only">{GRACE_SR}</span>
            {graceText(banner.days)}
            {banner.date && ` ${fill(C['MFA-BANNER-GRACE-DATE'], { date: banner.date })}`}
          </p>
          <div className="mt-2">
            <Link href="/admin/security?start=enroll" className={ADMIN_PRIMARY_BTN}>
              {C['MFA-BANNER-GRACE-BTN']}
            </Link>
          </div>
        </Notice>
      );
    case 'rc_not_saved':
    case 'rc_low':
      return (
        <Notice tone="warning" role="status">
          <p>{banner.kind === 'rc_low' ? fill(C['MFA-BANNER-RCLOW'], { n: banner.left }) : C['MFA-BANNER-RCNOTSAVED']}</p>
          <div className="mt-2">
            <Link href="/admin/security?start=recovery-codes" className={ADMIN_SECONDARY_BTN}>
              {C['MFA-BANNER-RC-BTN']}
            </Link>
          </div>
        </Notice>
      );
    case 'mode_optional':
      return (
        <Notice tone="info" role="status">
          <p>{banner.date ? fill(C['MFA-BANNER-MODE-OPTIONAL'], { date: banner.date }) : C['MFA-BANNER-MODE-OPTIONAL'].replace(/ \{date\}[^.]*\.$/, '')}</p>
        </Notice>
      );
  }
}
