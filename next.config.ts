import type { NextConfig } from "next";

// /auth/confirm 주소의 ?token=이 캐시·Referer·검색 색인으로 새지 않게 하는 응답 헤더(메타 태그만으로는 HTTP 응답에 실리지 않는다).
// 가입 마무리 서버 액션(POST)도 같은 주소로 가므로 같은 경로 규칙을 탄다.
export const CONFIRM_PAGE_HEADERS = [
  { key: "Cache-Control", value: "private, no-store" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/auth/confirm", headers: CONFIRM_PAGE_HEADERS }];
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
