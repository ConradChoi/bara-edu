import { siteConfig } from '@/data/site-config';

export default function ContactSection() {
  const digitsOnlyPhone = siteConfig.phone.replace(/[^0-9]/g, '');

  return (
    <section className="w-full bg-n-0">
      <div className="mx-auto flex max-w-[600px] flex-col items-center gap-6 px-5 py-14 text-center md:py-20">
        <h2 className="text-[20px] font-bold text-n-9 md:text-[24px]">문의하기</h2>
        <p className="text-[16px] text-n-7">강좌나 신청 방법이 궁금하시면 전화나 이메일로 편하게 문의해 주세요.</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <a
            href={`tel:${digitsOnlyPhone}`}
            className="inline-flex h-12 items-center justify-center rounded-pill border border-n-3 px-6 text-[15px] font-medium text-n-7 hover:border-indigo hover:text-indigo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo"
          >
            전화 문의 {siteConfig.phone}
          </a>
          <a
            href={`mailto:${siteConfig.email}`}
            className="inline-flex h-12 items-center justify-center rounded-pill border border-n-3 px-6 text-[15px] font-medium text-n-7 hover:border-indigo hover:text-indigo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo"
          >
            이메일 문의
          </a>
        </div>
      </div>
    </section>
  );
}
