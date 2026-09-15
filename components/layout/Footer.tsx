import Link from 'next/link';
import { siteConfig } from '@/data/site-config';
import { getLegalDocument } from '@/lib/supabase/queries';

// 환불정책은 CMS(legal_documents)에서 관리자가 실제로 작성·게시해야 존재하는 문서라 —
// 아직 만들어지지 않았거나 게시가 중단된 상태에서도 이 링크가 항상 보이면 클릭 시
// /legal/refund-policy가 404로 뜬다. 이용약관/개인정보처리방침과 달리 이 링크는 게시된
// 문서가 실제로 있을 때만 노출한다(대표 요청, 2026-09-15 — "등록된 환불정책은 Footer에
// 노출되어야 한다"). CMS에서 새 문서를 만들 때 slug는 반드시 `refund-policy`로 입력해야
// 이 링크가 찾는 문서와 연결된다.
const REFUND_POLICY_SLUG = 'refund-policy';

// 전자상거래법 제10조 표시사항 + 약관/처리방침 링크. 이전에는 "주식회사 일리아 · ylia.io"
// 한 줄뿐이었고 ComingSoon 화면에만 쓰여, 실제 서비스 화면(/courses, /my, /sign-in 등)
// 어디에도 법정 표시사항이 노출된 적이 없었다(홈 화면 작업 중 발견, 2026-08-10).
export default async function Footer() {
  const digitsOnlyPhone = siteConfig.phone.replace(/[^0-9]/g, '');
  const refundPolicy = await getLegalDocument(REFUND_POLICY_SLUG);

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
          {refundPolicy && (
            <Link href="/legal/refund-policy" className="text-[13px] text-indigo underline underline-offset-2">
              환불정책
            </Link>
          )}
        </div>
      </div>
    </footer>
  );
}
