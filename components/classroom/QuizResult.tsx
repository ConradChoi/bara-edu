// 합격 기준(60%)은 문서에 정의가 없어 참고 표시용으로 임의 채택한 값 — 수료 조건과 무관하다
// (Q7: 진도 100% + 과제 승인만이 수료 조건).
const PASS_THRESHOLD = 60;

export default function QuizResult({ score, attemptNo }: { score: number; attemptNo: number }) {
  const passed = score >= PASS_THRESHOLD;

  return (
    <div className={`rounded-md border px-3.5 py-3 text-[13px] ${passed ? 'border-success bg-success/10' : 'border-warning bg-warning/10'}`}>
      <p className={`font-semibold ${passed ? 'text-success' : 'text-warning'}`}>
        {attemptNo}번째 응시 · {score}점 {passed ? '(합격)' : ''}
      </p>
      {!passed && <p className="mt-0.5 text-[12px] text-n-7">재응시는 몇 번이든 할 수 있어요.</p>}
    </div>
  );
}
