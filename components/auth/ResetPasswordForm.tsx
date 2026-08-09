'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// 이 폼만 예외적으로 서버 액션이 아니라 클라이언트에서 직접 Supabase를 호출한다:
// 비밀번호 재설정 링크의 access_token은 URL 해시로만 전달된다. @supabase/ssr의
// createBrowserClient는 쿠키 기반 세션 관리를 전제로 하고 있어 implicit flow 해시
// (#access_token=...&type=recovery)를 항상 자동으로 감지해 세션화해주지는 않는다
// (실측: onAuthStateChange/getSession이 끝까지 응답하지 않는 문제 발생, 2026-08-08).
// 그래서 해시를 직접 파싱해 setSession()으로 명시적으로 세션을 만든다.
export default function ResetPasswordForm() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    async function establishSession() {
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');

      if (!accessToken || !refreshToken) {
        setLinkError('링크가 올바르지 않아요. 재설정 이메일을 다시 요청해주세요.');
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      // URL에 토큰이 그대로 남아있지 않도록 정리한다(주소창 노출·새로고침 시 재사용 방지).
      window.history.replaceState(null, '', window.location.pathname);

      if (sessionError) {
        setLinkError('링크가 만료됐거나 이미 사용됐어요. 재설정 이메일을 다시 요청해주세요.');
        return;
      }
      setReady(true);
    }

    void establishSession();
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('비밀번호는 8자 이상이어야 해요');
      return;
    }
    if (password !== confirm) {
      setError('비밀번호가 일치하지 않아요');
      return;
    }

    setPending(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setPending(false);

    if (updateError) {
      setError('비밀번호 변경에 실패했어요. 링크가 만료됐을 수 있어요. 다시 요청해주세요.');
      return;
    }

    await supabase.auth.signOut();
    router.push('/sign-in?resetSuccess=1');
  }

  if (linkError) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-danger">{linkError}</p>
        <Link href="/sign-in" className="text-[12.5px] font-medium text-pink">
          로그인 화면으로
        </Link>
      </div>
    );
  }

  if (!ready) {
    return <p className="text-[13px] text-n-6">링크를 확인하고 있어요...</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5 text-[13px]">
        <span className="text-n-7">새 비밀번호</span>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="8자 이상 입력하세요"
          className="h-11 rounded-md border border-n-3 bg-n-1 px-3 text-[13px] text-n-9 outline-none placeholder:text-n-5 focus:border-pink"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px]">
        <span className="text-n-7">새 비밀번호 확인</span>
        <input
          type="password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="h-11 rounded-md border border-n-3 bg-n-1 px-3 text-[13px] text-n-9 outline-none placeholder:text-n-5 focus:border-pink"
        />
      </label>

      {error && <p className="text-[12.5px] text-danger">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="h-[46px] rounded-pill bg-pink text-[14px] font-semibold text-white disabled:opacity-60"
      >
        {pending ? '변경 중...' : '비밀번호 변경'}
      </button>
    </form>
  );
}
