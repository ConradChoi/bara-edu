"use client";

import { useState } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

export default function ComingSoon() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || status === "loading") return;

    setStatus("loading");
    try {
      const scriptUrl = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;
      if (!scriptUrl) {
        setStatus("success");
        setMessage("사전 신청이 완료되었습니다. 오픈 소식을 가장 먼저 보내드릴게요!");
        setEmail("");
        return;
      }

      const res = await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ email, source: "coming-soon" }),
      });
      const text = await res.text();
      const data = JSON.parse(text);

      if (data.status === 409) {
        setStatus("error");
        setMessage(data.error ?? "이미 신청된 이메일입니다.");
      } else if (data.ok) {
        setStatus("success");
        setMessage("사전 신청이 완료되었습니다. 오픈 소식을 가장 먼저 보내드릴게요!");
        setEmail("");
      } else {
        setStatus("error");
        setMessage(data.error ?? "오류가 발생했습니다. 다시 시도해 주세요.");
      }
    } catch {
      setStatus("error");
      setMessage("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col overflow-x-hidden"
      style={{ backgroundColor: "#ffffff" }}
    >
      <Header showNav={false} />

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

        {/* 이메일 신청 폼 */}
        <div
          style={{
            width: "100%",
            maxWidth: 480,
            marginTop: 8,
          }}
        >
          {status !== "success" ? (
            <form
              onSubmit={handleSubmit}
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
            >
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="이메일 주소를 입력해 주세요"
                  disabled={status === "loading"}
                  className="w-full sm:flex-1"
                  style={{
                    height: 52,
                    borderRadius: 10,
                    border: "1.5px solid #e5e7eb",
                    backgroundColor: "#f9fafb",
                    padding: "0 16px",
                    fontSize: 14,
                    color: "#1a1a1a",
                    outline: "none",
                    minWidth: 0,
                  }}
                />
                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="w-full sm:w-auto"
                  style={{
                    height: 52,
                    borderRadius: 10,
                    backgroundColor: status === "loading" ? "#f0a868" : "#E67E22",
                    color: "#ffffff",
                    fontWeight: 700,
                    fontSize: 14,
                    padding: "0 24px",
                    border: "none",
                    cursor: status === "loading" ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {status === "loading" ? "신청 중…" : "사전 신청하기"}
                </button>
              </div>
              {status === "error" && (
                <p style={{ fontSize: 12, color: "#dc2626", textAlign: "center" }}>
                  {message}
                </p>
              )}
            </form>
          ) : (
            <p
              className="text-center font-medium"
              style={{ fontSize: 14, color: "#E67E22" }}
            >
              ✓ {message}
            </p>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
