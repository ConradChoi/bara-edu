import { unstable_rethrow } from 'next/navigation';
import FilterChip from '@/components/courses/FilterChip';
import { getActiveCategoryTree } from '@/lib/supabase/queries';

export default async function CategorySection() {
  // 조회 실패 시 홈 전체를 오류 화면으로 바꾸지 않고 이 섹션만 숨긴다(home.md 11.7, QA Major-1, 2026-11-28).
  let categories: Awaited<ReturnType<typeof getActiveCategoryTree>>;
  try {
    categories = await getActiveCategoryTree();
  } catch (err) {
    unstable_rethrow(err);
    console.error('[home] category section failed', err);
    return null;
  }
  const topCategories = categories.filter((c) => c.depth === 1);

  if (topCategories.length === 0) return null;

  return (
    <section className="w-full bg-n-0">
      <div className="mx-auto max-w-[1200px] px-5 py-14 md:px-6 md:py-20">
        <h2 className="text-center text-[22px] font-bold text-n-9 md:text-[28px]">분야별로 살펴보기</h2>
        <p className="mt-2 text-center text-[16px] text-n-6">관심 있는 분야를 선택하면 관련 강좌만 모아 볼 수 있어요.</p>
        <div className="mx-auto mt-8 flex max-w-[900px] flex-wrap justify-center gap-2 md:gap-3">
          {topCategories.map((c) => (
            <FilterChip key={c.id} label={c.name} href={`/courses?category=${c.id}`} />
          ))}
        </div>
      </div>
    </section>
  );
}
