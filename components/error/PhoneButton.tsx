import { siteConfig } from '@/data/site-config';
import { PhoneIcon } from './icons';

// 전화 문의 버튼 (정의서 D-1.5). 번호와 운영시간은 siteConfig에서만 가져온다 — 하드코딩 금지.
// 라벨과 번호를 두 줄로 나눠 문구를 못 읽는 사용자도 숫자로 행동할 수 있게 하고, 운영시간은 버튼 아래에 둔다.
export default function PhoneButton({ emphasized = false }: { emphasized?: boolean }) {
  const digitsOnlyPhone = siteConfig.phone.replace(/[^0-9]/g, '');
  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      <a
        href={`tel:${digitsOnlyPhone}`}
        className={`flex w-full min-h-[72px] flex-col items-center justify-center gap-0.5 rounded-pill px-6 py-2 text-n-9 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-indigo ${
          emphasized ? 'border-2 border-indigo bg-n-0 hover:bg-n-1' : 'border border-n-3 bg-n-1 hover:bg-n-2'
        }`}
      >
        <span className="inline-flex items-center gap-2 text-lg font-semibold">
          <PhoneIcon className="size-5" />
          전화로 문의하기
        </span>
        <span className="text-[22px] font-bold leading-tight tracking-wide">{siteConfig.phone}</span>
      </a>
      <p className="text-sm leading-[1.6] text-n-6 break-keep">{siteConfig.supportHours}</p>
    </div>
  );
}
