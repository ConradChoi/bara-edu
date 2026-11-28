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
  // 전화 문의 가능 시간. API 안내 메일(api/src/mail/support.ts)의 SUPPORT_HOURS와 같아야 한다.
  supportHours: '평일 10:00~18:00(점심 11:30~13:00 제외)',
  email: 'info@ylia.io',
  address: '경기도 광명시 오리로 362 4층 (창업지원센터)',
  // 전자상거래법 제10조·시행규칙 제7조 표시사항(개인정보 점검 Must, 2026-11-28). 호스팅은 처리방침 제5조 수탁자와 같아야 한다.
  hostingProvider: 'Amazon Web Services, Inc.',
  // 공정위 사업자정보 공개페이지. wrkr_no는 사업자등록번호 숫자만.
  ftcBizInfoUrl: 'https://www.ftc.go.kr/bizCommPop.do?wrkr_no=8328603446',
  kakaoUrl: undefined,
  instagramUrl: undefined,
  openingDate: '2026년 하반기',
  isOpen: process.env.NEXT_PUBLIC_IS_OPEN === 'true',
};
