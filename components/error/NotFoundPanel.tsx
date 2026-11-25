'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SearchIcon } from './icons';
import ErrorTitle from './ErrorTitle';
import PhoneButton from './PhoneButton';
import { ACTIONS_CLASS, DESC_CLASS, PRIMARY_BTN, ROOT_CLASS, SECONDARY_BTN } from './styles';

// 사용자용 404 (E-404-R/P/U 공유). 추천 카드는 넣지 않는다(대표 결정). 홈/강좌/전화 3개 행동만.
// hardLinks: 루트 404는 헤더가 간이라 일반 앵커(전체 새로고침)를 쓴다.
export default function NotFoundPanel({ hardLinks = false }: { hardLinks?: boolean }) {
  const pathname = usePathname() ?? '';
  // 없는 강좌와 비공개/마감 강좌를 구분하지 않는다(존재 여부 비노출).
  const isCourse = /^\/courses\/[^/]+/.test(pathname);
  const A = hardLinks ? 'a' : Link;

  return (
    <section aria-labelledby="error-title" className={ROOT_CLASS}>
      <div className="flex size-16 items-center justify-center rounded-pill bg-n-1 text-indigo md:size-20">
        <SearchIcon className="size-8 md:size-10" />
      </div>
      <ErrorTitle>찾으시는 페이지가 없어요</ErrorTitle>
      <p className={DESC_CLASS}>
        {isCourse
          ? '찾으시는 강좌가 없거나 지금은 신청을 받지 않아요. 아래에서 원하는 곳으로 이동해 주세요.'
          : '주소가 바뀌었거나 없어진 페이지예요. 아래에서 원하는 곳으로 이동해 주세요.'}
      </p>
      <div className={ACTIONS_CLASS}>
        <A href="/" className={PRIMARY_BTN}>
          홈으로 가기
        </A>
        <A href="/courses" className={SECONDARY_BTN}>
          강좌 보러가기
        </A>
        <PhoneButton />
      </div>
    </section>
  );
}
