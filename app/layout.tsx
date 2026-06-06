import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "바라 평생교육원",
  description:
    "직업교육, 자격증, 외국어, 취미까지 다양한 강좌를 제공하는 바라 평생교육원입니다. 주식회사 일리아가 운영합니다.",
  keywords: ["평생교육", "자격증", "직업교육", "외국어", "취미", "바라평생교육원"],
  icons: {
    icon: "/images/ylia.png",
    apple: "/images/ylia.png",
  },
  openGraph: {
    title: "바라 평생교육원",
    description: "배움으로 새로운 나를 창조합니다",
    url: "https://bara-edu.kr",
    siteName: "바라 평생교육원",
    locale: "ko_KR",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body
        style={{
          fontFamily:
            "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          margin: 0,
          padding: 0,
        }}
      >
        {children}
      </body>
    </html>
  );
}
