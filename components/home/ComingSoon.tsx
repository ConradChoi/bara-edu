// Header/Footer는 더 이상 여기서 직접 렌더링하지 않는다 — 이 컴포넌트를 감싸는
// app/(public)/page.tsx가 이제 (public)/layout.tsx 안에 있어 AppHeader와 전역 Footer를
// 자동으로 상속받는다(design.md 4.5.8). 예전처럼 여기서도 그리면 Footer가 두 번
// 나오게 된다(홈 화면 작업 중 발견, 2026-08-10).
// 사전신청 이메일 폼은 정식 오픈(2026-11-27)에 뺐다 — 처리방침에 없는 수집이라 오픈과 함께 폐지·파기(home.md 5절, 정식 오픈 계획).
// 이 화면은 NEXT_PUBLIC_IS_OPEN이 true가 아닐 때(되돌릴 때)만 보인다.
export default function ComingSoon() {
  return (
    <div
      className="min-h-screen flex flex-col overflow-x-hidden"
      style={{ backgroundColor: "#ffffff" }}
    >
      {/* 메인 콘텐츠 */}
      <main className="flex-1 flex flex-col items-center justify-center px-5 py-16 gap-6">

        {/* COMING SOON 배지 */}
        <span
          style={{
            display: "inline-block",
            backgroundColor: "#E67E22",
            color: "#ffffff",
            borderRadius: 20,
            padding: "6px 16px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
          }}
        >
          COMING SOON
        </span>

        {/* 메인 타이틀 */}
        <h1
          className="text-center font-extrabold"
          style={{
            fontSize: "clamp(2.2rem, 8vw, 4rem)",
            lineHeight: 1.15,
            color: "#1a1a1a",
            letterSpacing: "-0.02em",
            marginTop: 8,
          }}
        >
          2027년에 만나요,
          <br />
          BARA LIFELONG EDUCATION
        </h1>

        {/* 서브타이틀 */}
        <p
          className="text-center"
          style={{
            fontSize: "clamp(16px, 4vw, 20px)",
            color: "#374151",
            fontWeight: 500,
          }}
        >
          배움으로 새로운 나를 창조합니다
        </p>

        {/* 히브리어 브랜드 */}
        <p
          className="text-center"
          style={{
            fontSize: 14,
            color: "#9ca3af",
            letterSpacing: "0.02em",
          }}
        >
          בָּרָא · 히브리어로 &lsquo;창조하다&rsquo;
        </p>

        {/* 설명 문구 */}
        <div
          className="text-center"
          style={{ maxWidth: 480, display: "flex", flexDirection: "column", gap: 6 }}
        >
          <p style={{ fontSize: 15, color: "#6b7280", lineHeight: 1.7 }}>
            바라 평생교육원에서 배움의 기쁨을 되찾으세요.
          </p>
          <p style={{ fontSize: 15, color: "#6b7280", lineHeight: 1.7 }}>
            직업교육, 자격증, 외국어, 취미까지 다양한 강좌가 준비됩니다.
          </p>
        </div>

      </main>
    </div>
  );
}
