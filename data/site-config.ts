import { SiteConfig } from '@/lib/types';

// 법무 문서(docs/01-plan/features/bara-edu-lms.legal-terms.md 부칙 "사업자 정보")와
// 반드시 일치해야 하는 단일 출처다 — 이전에는 더미값(010-0000-0000, 서울특별시)이 그대로
// 남아있었고 어디에서도 쓰이지 않는 죽은 파일이었다. Footer가 이 값을 실제로 렌더링한다
// (홈 화면 작업 중 발견, 2026-08-10).
export const siteConfig: SiteConfig = {
  name: '바라 평생교육원',
  operator: '주식회사 일리아',
  representative: '최종훈',
  businessRegistrationNumber: '832-86-03446',
  mailOrderLicenseNumber: '제2026-경기광명-0607호',
  phone: '010-9025-5093',
  email: 'info@ylia.io',
  address: '경기도 광명시 오리로 362 4층 (창업지원센터)',
  kakaoUrl: undefined,
  instagramUrl: undefined,
  openingDate: '2026년 하반기',
  isOpen: process.env.NEXT_PUBLIC_IS_OPEN === 'true',
};
