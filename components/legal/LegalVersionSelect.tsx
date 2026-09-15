'use client';

import { useRouter } from 'next/navigation';

// 약관/정책 문서의 버전 선택 드롭다운. 순수 네비게이션이라 서버 상태를 갖지 않지만,
// <select onChange>는 실제 브라우저 이벤트 리스너가 필요해 이 프로젝트의 다른 예외
// (PrintButton 등)와 동일한 이유로 클라이언트 컴포넌트여야 한다. 버전이 1개뿐인
// 문서(예: 이용약관)에는 애초에 렌더하지 않는다(page.tsx에서 versions.length > 1일 때만 사용).
export default function LegalVersionSelect({
  slug,
  versions,
  currentVersion,
}: {
  slug: string;
  versions: { version: number; isCurrent: boolean }[];
  currentVersion: number;
}) {
  const router = useRouter();

  return (
    <select
      value={currentVersion}
      onChange={(e) => {
        const target = versions.find((v) => v.version === Number(e.target.value));
        router.push(target?.isCurrent ? `/legal/${slug}` : `/legal/${slug}?v=${target?.version}`);
      }}
      className="h-9 rounded-md border border-n-3 bg-n-0 px-2.5 text-[12.5px] text-n-7 outline-none focus:border-pink"
    >
      {versions.map((v) => (
        <option key={v.version} value={v.version}>
          v{v.version}
          {v.isCurrent ? ' (현재)' : ' (이전 버전)'}
        </option>
      ))}
    </select>
  );
}
