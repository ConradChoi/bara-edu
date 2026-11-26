import type { Metadata } from 'next';
import ResetLinkInvalid from '@/components/auth/ResetLinkInvalid';
import ResetPasswordForm from '@/components/auth/ResetPasswordForm';
import { PAGE_TITLE_CLASS } from '@/components/auth/styles';

// 토큰이 주소에 있으므로 Referer로 새지 않게 하고 색인하지 않는다(HTTP 헤더는 next.config.ts의 CONFIRM_PAGE_HEADERS).
// 링크를 여는 GET은 토큰을 쓰지 않는다 — 토큰은 비밀번호를 보내는 서버 액션(POST)에서만 소모된다(메일 스캐너 대비).
export const metadata: Metadata = {
  title: '비밀번호 재설정 | 바라 평생교육원',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

// API 토큰 한도는 200자다. 그보다 길거나 없으면 서버를 부르지 않고 링크 오류 화면을 보인다.
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token: raw } = await searchParams;
  const token = typeof raw === 'string' ? raw : '';
  if (!token || token.length > 200) return <ResetLinkInvalid />;

  return (
    <section aria-labelledby="reset-title" className="flex flex-col">
      <h1 id="reset-title" tabIndex={-1} className={PAGE_TITLE_CLASS}>
        비밀번호 재설정
      </h1>
      <ResetPasswordForm token={token} />
    </section>
  );
}
