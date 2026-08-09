import type { Metadata } from 'next';
import {
  createCategory,
  deleteCategory,
  moveCategoryDown,
  moveCategoryUp,
  toggleCategoryActive,
  updateCategory,
} from '@/app/actions/admin-categories';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { getCategoryCourseCounts } from '@/lib/supabase/admin-queries';
import { collectDescendantIds, getCategoryTree } from '@/lib/supabase/queries';
import type { Category } from '@/lib/types';

export const metadata: Metadata = { title: '카테고리 관리 | 관리자' };

const SUCCESS_MESSAGE: Record<string, string> = {
  created: '카테고리를 추가했어요.',
  updated: '수정했어요.',
  reordered: '순서를 변경했어요.',
  deleted: '삭제했어요.',
};

const ERROR_MESSAGE: Record<string, string> = {
  'name-required': '이름을 입력해주세요.',
  'depth-exceeded': '3Depth를 초과하는 하위 카테고리는 만들 수 없어요.',
  'has-children': '하위 카테고리가 있어 삭제할 수 없어요. 먼저 하위 카테고리를 정리해주세요.',
  'has-courses': '이 카테고리를 쓰는 강좌가 있어 삭제할 수 없어요. 대신 비활성화해주세요.',
  'already-processed': '다른 곳에서 이미 변경됐어요. 새로고침 후 다시 시도해주세요.',
  failed: '처리 중 문제가 발생했어요.',
};

export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const [categories, courseCounts] = await Promise.all([getCategoryTree(), getCategoryCourseCounts()]);

  const usageCount = (category: Category) => {
    const ids = collectDescendantIds(category.id, categories);
    return ids.reduce((sum, id) => sum + (courseCounts[id] ?? 0), 0);
  };

  const level1 = categories.filter((c) => c.depth === 1);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[20px] font-semibold text-n-9">카테고리 관리</h1>

      {success && SUCCESS_MESSAGE[success] && (
        <div className="rounded-md border border-success bg-success/10 px-3.5 py-3 text-[13px] font-medium text-success">
          {SUCCESS_MESSAGE[success]}
        </div>
      )}
      {error && ERROR_MESSAGE[error] && (
        <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          {ERROR_MESSAGE[error]}
        </div>
      )}

      <form action={createCategory} className="flex items-end gap-2 rounded-lg border border-n-3 bg-n-1 p-4">
        <label className="flex flex-1 flex-col gap-1 text-[12.5px] text-n-7">
          이름
          <input name="name" required className="h-10 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]" />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-[12.5px] text-n-7">
          상위 카테고리 (선택 안 하면 1Depth)
          <select name="parentId" className="h-10 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]">
            <option value="">(최상위)</option>
            {categories
              .filter((c) => c.depth < 3)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {'　'.repeat(c.depth - 1)}
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <button type="submit" className="h-10 shrink-0 rounded-pill bg-pink px-4 text-[13px] font-semibold text-white">
          추가
        </button>
      </form>

      <div className="flex flex-col gap-2">
        {level1.map((c1) => (
          <CategoryNode key={c1.id} category={c1} categories={categories} usageCount={usageCount} />
        ))}
      </div>
    </div>
  );
}

function CategoryNode({
  category,
  categories,
  usageCount,
}: {
  category: Category;
  categories: Category[];
  usageCount: (c: Category) => number;
}) {
  const children = categories.filter((c) => c.parentId === category.id);
  const usage = usageCount(category);

  return (
    <div className="rounded-lg border border-n-3">
      <div
        className="flex flex-wrap items-center gap-2 p-3"
        style={{ paddingLeft: `${12 + (category.depth - 1) * 20}px` }}
      >
        <form action={updateCategory.bind(null, category.id)} className="flex flex-1 items-center gap-2">
          <input
            name="name"
            defaultValue={category.name}
            className={`h-9 min-w-[120px] flex-1 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px] ${
              category.isActive ? 'text-n-9' : 'text-n-4 line-through'
            }`}
          />
          <button type="submit" className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7">
            저장
          </button>
        </form>

        <span className="text-[11px] text-n-5">강좌 {usage}건</span>

        <div className="flex gap-1">
          <form action={moveCategoryUp.bind(null, category.id)}>
            <button type="submit" className="rounded-pill border border-n-3 px-2 py-1 text-[11px] text-n-7">
              ▲
            </button>
          </form>
          <form action={moveCategoryDown.bind(null, category.id)}>
            <button type="submit" className="rounded-pill border border-n-3 px-2 py-1 text-[11px] text-n-7">
              ▼
            </button>
          </form>
          <form action={toggleCategoryActive.bind(null, category.id)}>
            <input type="hidden" name="current" value={String(category.isActive)} />
            <button type="submit" className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7">
              {category.isActive ? '비활성화' : '활성화'}
            </button>
          </form>
          <ConfirmDialog
            triggerLabel="삭제"
            triggerClassName="rounded-pill border border-danger px-2.5 py-1 text-[11.5px] text-danger"
            title="카테고리를 삭제할까요?"
            description="되돌릴 수 없어요."
            confirmLabel="삭제"
            tone="danger"
            disabled={usage > 0 || children.length > 0}
            disabledReason={
              children.length > 0
                ? '하위 카테고리가 있어 삭제할 수 없어요. 먼저 하위 카테고리를 정리해주세요.'
                : `이 카테고리를 쓰는 강좌가 ${usage}건 있어요. 삭제 대신 비활성화해주세요.`
            }
            action={deleteCategory.bind(null, category.id)}
          />
        </div>
      </div>

      {children.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-n-2 p-2">
          {children.map((child) => (
            <CategoryNode key={child.id} category={child} categories={categories} usageCount={usageCount} />
          ))}
        </div>
      )}

      {category.depth < 3 && (
        <form action={createCategory} className="flex items-center gap-2 border-t border-n-2 p-2">
          <input type="hidden" name="parentId" value={category.id} />
          <input
            name="name"
            placeholder={`${category.name} 하위 카테고리 추가`}
            className="h-8 flex-1 rounded-md border border-n-3 bg-n-0 px-2 text-[12px]"
          />
          <button type="submit" className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7">
            추가
          </button>
        </form>
      )}
    </div>
  );
}
