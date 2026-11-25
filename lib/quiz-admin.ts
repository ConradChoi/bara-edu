// 관리자 퀴즈 편집 화면의 안내용 규칙. API(get_quiz_for_lesson·submit_quiz_attempt)는 정답이 설정되지 않은
// 문항을 학습자에게 보여 주지 않고 채점에서도 뺀다(2026-11-25) — 같은 기준을 화면에서 알려 준다.
export const QUIZ_HIDDEN_NOTICE = '정답이 지정되지 않은 문항은 학습자에게 보이지 않아요.';
export const NO_CORRECT_LABEL = '정답 없음 — 학습자에게 보이지 않아요';

export function hasCorrectOption(q: { options: { isCorrect: boolean }[] }): boolean {
  return q.options.some((o) => o.isCorrect);
}

export function countHiddenQuestions(questions: { options: { isCorrect: boolean }[] }[]): number {
  return questions.filter((q) => !hasCorrectOption(q)).length;
}
