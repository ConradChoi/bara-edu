// 스타일 래퍼만 제공한다 — 컬럼 설정 기반의 범용 테이블은 만들지 않는다(YAGNI).
// 각 페이지가 자기 <thead>/<tbody>를 직접 작성하고 이 컴포넌트로만 감싼다.
export default function AdminTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-n-3 bg-n-0">
      <table
        className="w-full min-w-[640px] border-collapse text-[13px]
          [&_td]:border-b [&_td]:border-n-2 [&_td]:px-4 [&_td]:py-3 [&_td]:text-n-8
          [&_th]:border-b [&_th]:border-n-3 [&_th]:bg-n-1 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[12px] [&_th]:font-medium [&_th]:text-n-6
          [&_tr:last-child_td]:border-b-0"
      >
        {children}
      </table>
    </div>
  );
}
