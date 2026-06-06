import { SiteConfig } from '@/lib/types';

export const siteConfig: SiteConfig = {
  name: '바라 평생교육원',
  phone: '010-0000-0000',
  email: 'info@bara-edu.kr',
  address: '서울특별시',
  kakaoUrl: undefined,
  instagramUrl: undefined,
  openingDate: '2026년 하반기',
  isOpen: process.env.NEXT_PUBLIC_IS_OPEN === 'true',
};
