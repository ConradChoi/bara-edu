import type { Metadata } from 'next';
import SignupFinishForm from '@/components/auth/SignupFinishForm';
import SignupLinkStatus from '@/components/auth/SignupLinkStatus';
import { checkSignupLink } from '@/lib/db/auth';
import { formatRemaining, formatRequestedAt } from '@/lib/signup-confirm-format';

// 토큰이 주소에 있으므로 Referer로 새어 나가지 않게 하고, 검색에 잡히지 않게 한다.
// 메일 속 링크를 여는 GET은 읽기만 한다(checkSignupLink). 가입 확정은 비밀번호를 보내는 서버 액션(POST)에서만 일어난다 —
// 메일 보안 검사기가 링크를 미리 열어도 토큰이 소모되지 않는다.
export const metadata: Metadata = {
  title: '가입 마무리 | 바라 평생교육원',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token: raw } = await searchParams;
  const token = typeof raw === 'string' ? raw : '';
  if (!token || token.length > 200) return <SignupLinkStatus status="invalid" />;

  const retryHref = `/auth/confirm?token=${encodeURIComponent(token)}`;
  const check = await checkSignupLink(token).catch(() => ({ ok: false, reason: 'unavailable' }) as const);
  if (!check.ok) {
    return <SignupLinkStatus status={check.reason === 'rate_limited' ? 'rate_limited' : 'unavailable'} retryHref={retryHref} />;
  }

  const link = check.link;
  if (link.state !== 'ready') return <SignupLinkStatus status={link.state} />;

  return (
    <SignupFinishForm
      token={token}
      email={link.email}
      requestedLabel={formatRequestedAt(link.requestedAt)}
      remainingLabel={formatRemaining(link.expiresAt)}
      attemptsLeft={link.attemptsLeft}
    />
  );
}
