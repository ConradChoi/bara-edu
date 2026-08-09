'use client';

import { useMemo, useState } from 'react';
import type { Category } from '@/lib/types';

// 강좌 등록/수정 폼에서 1~3Depth 카테고리를 순차 선택한다(F-ADMC-4).
// leaf가 아닌 상위 depth 선택도 유효하므로, 제출값은 "가장 깊게 선택된 id" 하나다.
export default function CategoryPicker({
  categories,
  defaultCategoryId,
  name = 'categoryId',
}: {
  categories: Category[];
  defaultCategoryId?: string;
  name?: string;
}) {
  const [selected, setSelected] = useState<(string | null)[]>(() => buildPath(defaultCategoryId, categories));

  const level1 = useMemo(() => categories.filter((c) => c.depth === 1), [categories]);
  const level2 = useMemo(
    () => categories.filter((c) => c.depth === 2 && c.parentId === selected[0]),
    [categories, selected]
  );
  const level3 = useMemo(
    () => categories.filter((c) => c.depth === 3 && c.parentId === selected[1]),
    [categories, selected]
  );

  const value = selected[2] ?? selected[1] ?? selected[0] ?? '';

  return (
    <div className="flex gap-2">
      <input type="hidden" name={name} value={value} required />
      <select
        value={selected[0] ?? ''}
        onChange={(e) => setSelected([e.target.value || null, null, null])}
        className="h-10 flex-1 rounded-md border border-n-3 bg-n-0 px-2 text-[13px]"
      >
        <option value="">1Depth 선택</option>
        {level1.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        value={selected[1] ?? ''}
        onChange={(e) => setSelected([selected[0], e.target.value || null, null])}
        disabled={level2.length === 0}
        className="h-10 flex-1 rounded-md border border-n-3 bg-n-0 px-2 text-[13px] disabled:opacity-40"
      >
        <option value="">2Depth 선택</option>
        {level2.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        value={selected[2] ?? ''}
        onChange={(e) => setSelected([selected[0], selected[1], e.target.value || null])}
        disabled={level3.length === 0}
        className="h-10 flex-1 rounded-md border border-n-3 bg-n-0 px-2 text-[13px] disabled:opacity-40"
      >
        <option value="">3Depth 선택</option>
        {level3.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function buildPath(id: string | undefined, categories: Category[]): (string | null)[] {
  if (!id) return [null, null, null];
  const path: string[] = [];
  let current = categories.find((c) => c.id === id);
  while (current) {
    path.unshift(current.id);
    const parentId: string | null = current.parentId;
    current = parentId ? categories.find((c) => c.id === parentId) : undefined;
  }
  while (path.length < 3) path.push(null as unknown as string);
  return path;
}
