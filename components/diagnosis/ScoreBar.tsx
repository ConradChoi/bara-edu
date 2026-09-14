// 6영역 점수 막대(F-DIAG-10). 색상만으로 고저를 구분하지 않도록 수치(value)를 항상
// 텍스트로 병기한다(F-DIAG-18 접근성 — 색상 비의존).
export default function ScoreBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="text-n-9">{label}</span>
        <span className="font-semibold text-n-9">{clamped}점</span>
      </div>
      <div className="h-2 w-full rounded-full bg-n-2">
        <div className="h-2 rounded-full bg-pink" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
