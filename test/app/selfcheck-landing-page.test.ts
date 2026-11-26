import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Page from '@/app/(public)/selfcheck/page';
import { LANDING_NOTE } from '@/data/diagnosis/consent-copy';

test('랜딩: "약 5분 · 30문항" 배지 바로 아래 SC-LAND-NOTE', () => {
  const html = renderToStaticMarkup(Page());
  expect(LANDING_NOTE).toBe('응답과 결과는 민감정보로 다루기 때문에, 시작할 때 따로 동의를 받아요.');
  const badge = html.indexOf('약 5분 · 30문항');
  const note = html.indexOf(LANDING_NOTE);
  expect(badge).toBeGreaterThan(-1);
  expect(note).toBeGreaterThan(badge);
  expect(note).toBeLessThan(html.indexOf('진단 시작하기'));
});
