import type { NextConfig } from "next";

// /auth/confirm 주소의 ?token=이 캐시·Referer·검색 색인으로 새지 않게 하는 응답 헤더(메타 태그만으로는 HTTP 응답에 실리지 않는다).
// 가입 마무리 서버 액션(POST)도 같은 주소로 가므로 같은 경로 규칙을 탄다.
// 재설정 링크(/reset-password?token=)도 같은 이유로 같은 헤더를 건다(비밀번호 찾기 정의서 3장).
export const CONFIRM_PAGE_HEADERS = [
  { key: "Cache-Control", value: "private, no-store" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex" },
];

// /forgot-password: URL에 토큰·이메일이 없어 Referer 차단은 필요 없지만, 검색 노출이 필요 없고 입력 결과 화면을 캐시하지 않는다(정의서 2장).
export const FORGOT_PAGE_HEADERS = [
  { key: "Cache-Control", value: "private, no-store" },
  { key: "X-Robots-Tag", value: "noindex" },
];

export const MFA_PAGE_PATHS = ["/sign-in/otp", "/sign-in/recovery", "/sign-in/otp-setup", "/admin/security"];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/auth/confirm", headers: CONFIRM_PAGE_HEADERS },
      { source: "/reset-password", headers: CONFIRM_PAGE_HEADERS },
      { source: "/forgot-password", headers: FORGOT_PAGE_HEADERS },
      // 관리자 2단계 인증 화면: 대기표(쿠키)·QR·설정 키·복구 코드가 오가는 화면이라 캐시·색인·Referer를 막는다(기획서 3장 공통 규칙).
      ...MFA_PAGE_PATHS.map((source) => ({ source, headers: CONFIRM_PAGE_HEADERS })),
    ];
  },
  experimental: {
    // 휴대폰 사진(2~5MB)이 수강신청·정보수정 폼과 함께 올라오도록 기본 1MB에서 늘린다.
    // 앱의 사진 한도는 5MB 그대로(lib/db/storage), 폼 필드 여유분을 더해 6MB.
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
