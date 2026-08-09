export default function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const ratio = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11.5px] text-n-6">
        <span>진도</span>
        <span>{ratio}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-pill bg-n-2">
        <div className="h-full rounded-pill bg-pink" style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}
