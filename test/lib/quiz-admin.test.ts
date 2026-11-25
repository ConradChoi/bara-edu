import { expect, test } from 'vitest';
import { QUIZ_HIDDEN_NOTICE, NO_CORRECT_LABEL, hasCorrectOption, countHiddenQuestions } from '@/lib/quiz-admin';

const q = (id: string, correct: boolean[]) => ({ id, options: correct.map((isCorrect, i) => ({ id: `${id}-${i}`, isCorrect })) });

test('정답 보기가 하나라도 있으면 학습자에게 보이는 문항', () => {
  expect(hasCorrectOption(q('a', [false, true]))).toBe(true);
  expect(hasCorrectOption(q('b', [false, false]))).toBe(false);
  expect(hasCorrectOption(q('c', []))).toBe(false); // 보기가 없는 문항도 숨겨진다
});

test('숨겨지는 문항 수', () => {
  expect(countHiddenQuestions([q('a', [true]), q('b', [false]), q('c', []), q('d', [false, true])])).toBe(2);
  expect(countHiddenQuestions([])).toBe(0);
});

test('안내 문구', () => {
  expect(QUIZ_HIDDEN_NOTICE).toBe('정답이 지정되지 않은 문항은 학습자에게 보이지 않아요.');
  expect(NO_CORRECT_LABEL).toBe('정답 없음 — 학습자에게 보이지 않아요');
});
