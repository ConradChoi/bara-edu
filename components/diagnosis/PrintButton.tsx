'use client';

// F-DIAG-16 "PDF로 저장" — 서버 PDF 생성 없이 브라우저 인쇄로 Phase 1을 충족한다
// (신규 의존성 도입 금지 원칙, design.md 참고). 실제 인쇄 시 헤더/네비/CTA/리드폼을
// 숨기는 처리는 globals.css의 @media print 규칙(.print-hide)이 담당한다.
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print-hide h-11 w-full rounded-pill bg-pink text-[13px] font-semibold text-white"
    >
      PDF로 저장
    </button>
  );
}
