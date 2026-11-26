// 큰 글씨 계열 인증 화면(가입 마무리·비밀번호 찾기·재설정)이 함께 쓰는 클래스(디자인 스펙 V-0, 비밀번호 찾기 P-6).
// 새 토큰 없이 globals.css @theme 값만 쓴다.

// notice-danger: 오류 알림 상자. 글자는 n-9, danger는 왼쪽 선과 아이콘에만 쓴다(본문색 대비 미달).
export const NOTICE = 'flex gap-3 rounded-md border-l-4 border-danger bg-n-1 px-4 py-3 text-base leading-[1.6] text-n-9 break-keep';
// notice-info: 안내 상자(아이콘 없음).
export const NOTICE_INFO = 'rounded-md bg-n-1 px-4 py-3 text-base leading-[1.6] text-n-8 break-keep';

// 상태 화면(원형 아이콘 + 제목 + 설명) 제목·설명.
export const STATUS_TITLE_CLASS = 'scroll-mt-20 mt-5 text-2xl font-bold leading-[1.35] text-n-9 break-keep outline-none md:text-[28px]';
export const STATUS_DESC_CLASS = 'mt-3 text-lg leading-[1.7] text-n-7 break-keep';
// 입력 화면 제목(원형 아이콘 없음).
export const PAGE_TITLE_CLASS = 'scroll-mt-20 text-2xl font-bold leading-[1.35] text-n-9 break-keep outline-none md:text-[28px]';
