import type { Metadata } from 'next';
import ForgotPasswordForm from '@/components/auth/ForgotPasswordForm';
import { readSession } from '@/lib/db/session-cookie';

// 검색 노출이 필요 없는 화면이라 색인하지 않는다(응답 헤더 X-Robots-Tag·no-store는 next.config.ts).
// 이메일은 URL로 받지 않는다(?email= 미리 채움 없음, 대표 결정 6) — 접근 로그·Referer·기록에 주소가 남지 않게.
export const metadata: Metadata = {
  title: '비밀번호 찾기 | 바라 평생교육원',
  robots: { index: false, follow: false },
};

// 로그인 여부와 관계없이 연다(proxy.ts는 이 경로를 보호하지 않는다). 쿠키가 있으면 마이페이지 안내 한 줄만 더한다.
// 세션이 죽은 쿠키는 proxy가 요청에서 먼저 지운다.
export default async function ForgotPasswordPage() {
  const loggedIn = Boolean(await readSession());
  return <ForgotPasswordForm loggedIn={loggedIn} />;
}
