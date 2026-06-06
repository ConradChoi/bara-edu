"use client";

import Link from "next/link";

type HeaderProps = {
  showNav?: boolean;
};

export default function Header({ showNav = true }: HeaderProps) {
  return (
    <header
      className="relative z-10 w-full flex items-center justify-between px-6 md:px-16 lg:px-[120px]"
      style={{
        backgroundColor: "#ffffff",
        borderBottom: "1px solid #e5e7eb",
        height: 64,
      }}
    >
      {/* 로고 */}
      <Link
        href="/"
        className="flex items-center gap-2 font-bold"
        style={{ textDecoration: "none" }}
      >
        <span style={{ fontSize: 18, color: "#1a1a1a", fontWeight: 700 }}>
          BARA LIFELONG EDUCATION
        </span>
      </Link>

      {/* 네비게이션 (메인 오픈 후 표시) */}
      {showNav && (
        <nav>
          <ul className="flex gap-6" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {[
              { label: "강좌 안내", href: "/courses" },
              { label: "수강 신청", href: "/courses" },
            ].map(({ label, href }) => (
              <li key={label}>
                <Link
                  href={href}
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "#4b5563",
                    textDecoration: "none",
                  }}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
