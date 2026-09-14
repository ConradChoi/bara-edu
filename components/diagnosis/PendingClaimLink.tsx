'use client';

// [회원가입] 클릭 시 localStorage에 "이메일 인증 후 이 결과 페이지로 돌아가라"는 라우팅
// 힌트만 남긴다(회원가입은 이메일 인증이라는 비동기 왕복을 거쳐 로그인처럼 `?redirect=`를
// 왕복시킬 방법이 없다 — flows.md Q10 확정). 이 값은 순전히 "어디로 돌려보낼지"만 정할 뿐
// 귀속 여부를 좌우하지 않는다 — 실제 자동 귀속 여부는 RecoveryRedirect가 아니라 결과
// 페이지가 httpOnly 쿠키(RECENT_SUBMIT_COOKIE)로 판단하므로, 제3자가 이 localStorage 값을
// 흉내내도(클라이언트에서 읽고 쓸 수 있는 값이라 위조 가능) 자기 브라우저에 그 쿠키가 없으면
// 확인 절차 없이 귀속되지 않는다.
export default function PendingClaimLink({ token, className, children }: { token: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      href="/sign-up"
      className={className}
      onClick={() => {
        try {
          window.localStorage.setItem('bara_selfcheck_pending_claim', JSON.stringify({ token, savedAt: Date.now() }));
        } catch {
          // localStorage 접근 불가(프라이빗 브라우징 등) — 가입 자체는 계속 진행,
          // 다만 이메일 인증 후 자동으로 결과로 돌아오지는 못한다(허용 가능한 열화).
        }
      }}
    >
      {children}
    </a>
  );
}
