import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { redirect } from 'next/navigation';

// 홈 섹션·푸터는 조회가 실패해도 페이지 전체를 오류 화면으로 바꾸지 않는다(home.md 11.7, QA Major-1, 2026-11-28).
// Next 내부 신호(redirect 등)는 삼키지 않고 다시 던진다(unstable_rethrow).
const q = vi.hoisted(() => ({
  getActiveCategoryTree: vi.fn(),
  getPublicCourses: vi.fn(),
  getApprovedSeatsTaken: vi.fn(),
  getLegalDocument: vi.fn(),
}));
vi.mock('@/lib/supabase/queries', () => q);

import CourseSection from '@/components/home/CourseSection';
import CategorySection from '@/components/home/CategorySection';
import Footer from '@/components/layout/Footer';

const html = async (el: Promise<React.ReactElement | null>) => {
  const node = await el;
  return node ? renderToStaticMarkup(node) : '';
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  q.getActiveCategoryTree.mockResolvedValue([]);
  q.getPublicCourses.mockResolvedValue([]);
  q.getApprovedSeatsTaken.mockResolvedValue({});
  q.getLegalDocument.mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

test('강좌 조회 실패: 섹션 안에서 안내 + 강좌안내 링크, 예외는 밖으로 나가지 않는다', async () => {
  q.getPublicCourses.mockRejectedValue(new Error('api down'));
  const out = await html(CourseSection());
  expect(out).toContain('강좌 목록을 잠시 불러오지 못했어요.');
  expect(out).toContain('href="/courses"');
  expect(out).not.toContain('강좌를 준비하고 있어요');
});

test('정원 조회 실패도 같은 안내', async () => {
  q.getPublicCourses.mockResolvedValue([{ id: 'c1', categoryId: null, seats: 10 }]);
  q.getApprovedSeatsTaken.mockRejectedValue(new Error('api down'));
  expect(await html(CourseSection())).toContain('강좌 목록을 잠시 불러오지 못했어요.');
});

test('강좌 0건은 기존 빈 상태 문구 그대로', async () => {
  expect(await html(CourseSection())).toContain('강좌를 준비하고 있어요');
});

test('카테고리 조회 실패: 섹션만 숨김', async () => {
  q.getActiveCategoryTree.mockRejectedValue(new Error('api down'));
  expect(await CategorySection()).toBeNull();
});

test('푸터: 환불정책 조회 실패해도 법정 표시사항은 나오고 환불정책 링크만 빠진다', async () => {
  q.getLegalDocument.mockRejectedValue(new Error('api down'));
  const out = await html(Footer());
  expect(out).toContain('사업자등록번호');
  expect(out).toContain('호스팅서비스 제공 Amazon Web Services, Inc.');
  expect(out).toContain('href="https://www.ftc.go.kr/bizCommPop.do?wrkr_no=8328603446"');
  expect(out).toContain('href="/legal/privacy"');
  expect(out).not.toContain('/legal/refund-policy');
});

test('푸터: 환불정책이 게시돼 있으면 링크 노출', async () => {
  q.getLegalDocument.mockResolvedValue({ slug: 'refund-policy' });
  expect(await html(Footer())).toContain('href="/legal/refund-policy"');
});

test('Next 내부 신호(redirect)는 삼키지 않는다', async () => {
  q.getLegalDocument.mockImplementation(async () => redirect('/x'));
  await expect(Footer()).rejects.toThrow();
  q.getPublicCourses.mockImplementation(async () => redirect('/x'));
  await expect(CourseSection()).rejects.toThrow();
});
