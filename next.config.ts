import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 휴대폰 사진(2~5MB)이 수강신청·정보수정 폼과 함께 올라오도록 기본 1MB에서 늘린다.
    // 앱의 사진 한도는 5MB 그대로(lib/db/storage), 폼 필드 여유분을 더해 6MB.
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
