import { spokenCode } from '@/lib/mfa-format';

// 복구 코드·등록 코드·설정 키 띄어 읽기(디자인 스펙 T-8). 눈에 보이는 글자는 aria-hidden, 같은 자리에 글자 사이를 띄운 sr-only.
// "ABCDE-FGHJK"를 단어로 발음하거나 "12345678"을 큰 수로 읽지 않게 한다.
export default function SpokenCode({ code, groupSize, className }: { code: string; groupSize?: number; className?: string }) {
  return (
    <>
      <span aria-hidden="true" className={className}>
        {code}
      </span>
      <span className="sr-only">{spokenCode(code, groupSize)}</span>
    </>
  );
}
