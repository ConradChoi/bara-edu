import Link from 'next/link';
import { siteConfig } from '@/data/site-config';

// 전자상거래법 제10조 표시사항 + 약관/처리방침 링크. 데이터 조회가 없는 순수 컴포넌트다.
// 환불정책 링크는 CMS 조회가 필요해 Footer가 hasRefundPolicy로 넘긴다. 오류 화면(404, app/error.tsx, 503)은
// API 장애 중에 또 API를 부르면 안 되므로 이 컴포넌트만 쓰고 환불정책 링크는 생략한다.
export default function FooterBody({ hasRefundPolicy = false }: { hasRefundPolicy?: boolean }) {
  const digitsOnlyPhone = siteConfig.phone.replace(/[^0-9]/g, '');

  return (
    <footer className="w-full border-t border-n-3 bg-n-0">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-5 py-8 md:px-6 md:py-10 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
        <div className="flex flex-col gap-1.5 text-[13px] leading-[1.7]">
          <p>
            <span className="font-semibold text-n-9">{siteConfig.name}</span>
            <span className="text-n-6"> · 운영 {siteConfig.operator} · 대표 {siteConfig.representative}</span>
          </p>
          <p className="text-n-6">
            사업자등록번호 {siteConfig.businessRegistrationNumber} · 통신판매업 신고번호 {siteConfig.mailOrderLicenseNumber}
          </p>
          <p className="text-n-7">주소 {siteConfig.address}</p>
          <p className="text-n-7">
            대표전화{' '}
            <a href={`tel:${digitsOnlyPhone}`} className="hover:text-indigo hover:underline">
              {siteConfig.phone}
            </a>{' '}
            · 이메일{' '}
            <a href={`mailto:${siteConfig.email}`} className="hover:text-indigo hover:underline">
              {siteConfig.email}
            </a>
          </p>
        </div>

        <div className="mt-1 flex items-center gap-4 border-t border-n-2 pt-4 lg:mt-0 lg:flex-shrink-0 lg:border-t-0 lg:pt-0">
          <Link href="/legal/terms" className="text-[13px] text-indigo underline underline-offset-2">
            이용약관
          </Link>
          <Link href="/legal/privacy" className="text-[13px] font-bold text-indigo underline underline-offset-2">
            개인정보처리방침
          </Link>
          {hasRefundPolicy && (
            <Link href="/legal/refund-policy" className="text-[13px] text-indigo underline underline-offset-2">
              환불정책
            </Link>
          )}
        </div>
      </div>
    </footer>
  );
}
