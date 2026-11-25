// 오류 화면 버튼·배지 클래스 (정의서 D-1.4, D-1.5). 새 토큰 없이 globals.css @theme 값만 쓴다.
const BASE =
  'inline-flex w-full min-h-14 items-center justify-center gap-2 rounded-pill px-6 text-lg font-bold transition-colors ' +
  'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-indigo aria-disabled:cursor-wait aria-disabled:opacity-80';

export const PRIMARY_BTN = `${BASE} bg-indigo text-white hover:bg-arc-1`;
export const SECONDARY_BTN = `${BASE} border-2 border-indigo bg-n-0 text-indigo hover:bg-n-1`;

// 관리자 화면은 PC 전용이라 풀 와이드 없이 한 줄 flex-wrap, 높이 48px.
const ADMIN_BASE =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-pill px-6 text-[15px] font-bold transition-colors ' +
  'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-indigo aria-disabled:cursor-wait aria-disabled:opacity-80';
export const ADMIN_PRIMARY_BTN = `${ADMIN_BASE} bg-indigo text-white hover:bg-arc-1`;
export const ADMIN_SECONDARY_BTN = `${ADMIN_BASE} border-2 border-indigo bg-n-0 text-indigo hover:bg-n-1`;
export const ADMIN_TEXT_LINK =
  'inline-flex min-h-12 items-center px-2 text-[15px] text-n-7 underline underline-offset-2 ' +
  'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-indigo';

export const ROOT_CLASS =
  'mx-auto flex w-full max-w-[560px] flex-col items-center px-5 py-10 text-center md:px-6 md:py-20';
export const TITLE_CLASS =
  'mt-5 text-2xl font-bold leading-[1.35] text-n-9 break-keep outline-none md:mt-6 md:text-[32px]';
export const DESC_CLASS = 'mt-3 max-w-[34rem] text-lg leading-[1.7] text-n-7 break-keep md:mt-4';
export const ACTIONS_CLASS = 'mt-8 flex w-full flex-col gap-3 md:mt-10 md:max-w-[420px]';
