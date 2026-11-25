'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { siteConfig } from '@/data/site-config';
import ResendConfirmationForm from '@/components/auth/ResendConfirmationForm';
import { PRIMARY_BTN, SECONDARY_BTN } from '@/components/error/styles';
import { CircleCheckIcon, ClockIcon, LockIcon, PhoneIcon, WifiOffIcon } from '@/components/error/icons';

// 가입 마무리 링크의 상태 화면(디자인 스펙 V-2.3~V-2.6, 문구 문서 4.4~4.7).
// 좌측 정렬이고 채운 버튼은 화면마다 1개다. 색은 인디고 단색(경고색을 쓰지 않는다).
export type SignupLinkStatusKind = 'locked' | 'expired' | 'invalid' | 'done' | 'unavailable' | 'rate_limited';

const TITLE_CLASS = 'mt-5 text-2xl font-bold leading-[1.35] text-n-9 break-keep outline-none md:text-[28px]';
const DESC_CLASS = 'mt-3 text-lg leading-[1.7] text-n-7 break-keep';
const LINK_CLASS = `inline-flex min-h-11 items-center text-base text-indigo underline underline-offset-4 ${'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-indigo'}`;

function Phone() {
  const digits = siteConfig.phone.replace(/[^0-9]/g, '');
  return (
    <div className="flex flex-col gap-1.5">
      <a href={`tel:${digits}`} className={SECONDARY_BTN}>
        <PhoneIcon className="size-6" />
        전화 문의 {siteConfig.phone}
      </a>
      <p className="text-sm leading-[1.6] text-n-6 break-keep">{siteConfig.supportHours}</p>
    </div>
  );
}

export default function SignupLinkStatus({
  status,
  retryHref,
  focusOnMount = false,
}: {
  status: SignupLinkStatusKind;
  // unavailable·rate_limited일 때 "다시 시도하기"가 열 주소(같은 가입 마무리 주소)
  retryHref?: string;
  // 화면이 액션 응답으로 바뀐 직후에만 true — 제목으로 포커스를 옮겨 스크린리더가 새 화면을 처음부터 읽게 한다.
  focusOnMount?: boolean;
}) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) h1.current?.focus();
  }, [focusOnMount]);

  let icon: ReactNode;
  let title: string;
  let body: ReactNode;
  let actions: ReactNode;

  switch (status) {
    case 'locked':
      icon = <LockIcon className="size-7 md:size-8" />;
      title = '이 링크는 더 쓸 수 없어요';
      body = (
        <>
          <p className={DESC_CLASS}>비밀번호가 5번 맞지 않아서 이 링크를 잠갔어요. 개인정보를 지키기 위한 조치예요.</p>
          <p className={DESC_CLASS}>처음부터 다시 가입하면 새 인증 메일을 보내 드려요.</p>
        </>
      );
      actions = (
        <>
          <Link href="/sign-up" className={PRIMARY_BTN}>
            처음부터 다시 가입하기
          </Link>
          <p className="mt-3 text-base leading-[1.7] text-n-7 break-keep">다시 가입이 어려우면 전화로 문의해 주세요.</p>
          <Phone />
        </>
      );
      break;
    case 'expired':
    case 'invalid':
      icon = <ClockIcon className="size-7 md:size-8" />;
      title = '이 링크는 쓸 수 없어요';
      body = (
        <>
          <p className={DESC_CLASS}>링크가 만료됐거나 올바르지 않아요. 인증 링크는 24시간 동안 쓸 수 있어요.</p>
          <p className={DESC_CLASS}>아래에서 메일을 다시 받거나, 처음부터 다시 가입해 주세요.</p>
        </>
      );
      actions = (
        <>
          <ResendConfirmationForm size="lg" />
          <Link href="/sign-up" className={SECONDARY_BTN}>
            처음부터 다시 가입하기
          </Link>
          <Link href="/sign-in" className={LINK_CLASS}>
            이미 가입을 마쳤다면 로그인하기
          </Link>
          <p className="mt-3 text-base leading-[1.7] text-n-7 break-keep">어려우면 전화로 문의해 주세요.</p>
          <Phone />
        </>
      );
      break;
    case 'done':
      icon = <CircleCheckIcon className="size-7 md:size-8" />;
      title = '이미 가입을 마쳤어요';
      body = <p className={DESC_CLASS}>이메일과 비밀번호로 로그인해 주세요.</p>;
      actions = (
        <>
          <Link href="/sign-in" className={PRIMARY_BTN}>
            로그인하기
          </Link>
          <p className="mt-3 text-base leading-[1.7] text-n-7 break-keep">비밀번호가 기억나지 않으면 전화로 문의해 주세요.</p>
          <Phone />
        </>
      );
      break;
    case 'rate_limited':
      icon = <ClockIcon className="size-7 md:size-8" />;
      title = '요청이 많아요';
      body = <p className={DESC_CLASS}>잠시 후 다시 시도해 주세요. 입력한 횟수에는 포함되지 않아요.</p>;
      actions = retryHref ? (
        <a href={retryHref} className={PRIMARY_BTN}>
          다시 시도하기
        </a>
      ) : null;
      break;
    default:
      icon = <WifiOffIcon className="size-7 md:size-8" />;
      title = '지금 연결이 원활하지 않아요';
      body = <p className={DESC_CLASS}>잠시 후 다시 시도해 주세요. 계속 안 되면 전화로 문의해 주세요.</p>;
      actions = (
        <>
          {retryHref && (
            <a href={retryHref} className={PRIMARY_BTN}>
              다시 시도하기
            </a>
          )}
          <Phone />
        </>
      );
  }

  return (
    <section aria-labelledby="confirm-title" className="flex flex-col" data-status={status}>
      <div className="flex size-14 items-center justify-center rounded-pill bg-n-1 text-indigo md:size-16">{icon}</div>
      <h1 id="confirm-title" ref={h1} tabIndex={-1} className={TITLE_CLASS}>
        {title}
      </h1>
      {body}
      <div className="mt-8 flex flex-col gap-3">{actions}</div>
    </section>
  );
}
