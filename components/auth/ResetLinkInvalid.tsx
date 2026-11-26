import Link from 'next/link';
import { STATUS_DESC_CLASS, STATUS_TITLE_CLASS } from '@/components/auth/styles';
import { ClockIcon } from '@/components/error/icons';
import { LINK_CLASS, PRIMARY_BTN } from '@/components/error/styles';

// /reset-password에 토큰이 없거나 형식이 틀린 경우(메일 앱이 링크를 잘라 연 경우 등). 디자인 스펙 P-2.1, 카피 RP-NOTOKEN-*.
// 채운 버튼은 [재설정 메일 다시 받기] 하나다. 서버 렌더 첫 화면이라 포커스는 옮기지 않는다.
export default function ResetLinkInvalid() {
  return (
    <section aria-labelledby="reset-invalid-title" className="flex flex-col">
      <div className="flex size-14 items-center justify-center rounded-pill bg-n-1 text-indigo md:size-16">
        <ClockIcon className="size-7 md:size-8" />
      </div>
      <h1 id="reset-invalid-title" tabIndex={-1} className={STATUS_TITLE_CLASS}>
        이 링크는 쓸 수 없어요
      </h1>
      <p className={STATUS_DESC_CLASS}>링크가 올바르지 않아요. 메일에서 링크를 다시 열거나, 새 메일을 받아 주세요.</p>
      <div className="mt-8 flex flex-col gap-3">
        <Link href="/forgot-password" className={PRIMARY_BTN}>
          재설정 메일 다시 받기
        </Link>
        <Link href="/sign-in" className={`${LINK_CLASS} self-start`}>
          로그인 화면으로
        </Link>
      </div>
    </section>
  );
}
