import { Fragment } from 'react';

// 문구 상수의 `**…**` 부분을 굵게 그린다(data/diagnosis/consent.ts, consent-copy.ts 규칙). 그 밖의 마크업은 해석하지 않는다.
export default function BoldText({ text }: { text: string }) {
  const parts = text.split('**');
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <strong key={i} className="font-semibold text-n-9">{part}</strong> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}
