import { siteConfig } from '@/data/site-config';
import { PhoneIcon } from '@/components/error/icons';
import { SECONDARY_BTN } from '@/components/error/styles';

// 큰 글씨 인증 화면의 전화 문의 버튼(tel: 링크) + 운영시간. 번호·운영시간은 siteConfig에서만 가져온다(하드코딩 금지).
// 가입 마무리(SignupLinkStatus·SignupFinishForm)에 같은 마크업이 두 벌 있던 것을 한 곳으로 모았다.
export default function SupportPhone({ label = '전화 문의', hoursLabel }: { label?: string; hoursLabel?: string }) {
  const digits = siteConfig.phone.replace(/[^0-9]/g, '');
  return (
    <div className="flex flex-col gap-1.5">
      <a href={`tel:${digits}`} className={`${SECONDARY_BTN} !flex-col !gap-0 !py-2`}>
        <span className="inline-flex items-center gap-2">
          <PhoneIcon className="size-5" />
          {label}
        </span>
        <span className="whitespace-nowrap text-xl">{siteConfig.phone}</span>
      </a>
      <p className="text-sm leading-[1.6] text-n-6 break-keep">{hoursLabel ? `${hoursLabel} ${siteConfig.supportHours}` : siteConfig.supportHours}</p>
    </div>
  );
}
