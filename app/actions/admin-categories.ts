'use server';

import { redirect } from 'next/navigation';
import { requireAdminClient } from '@/lib/supabase/require-admin';
import { getCategoryChildCount } from '@/lib/supabase/admin-queries';

// 카테고리 관리 (F-ADMCAT-1~3). Depth 제한(최대 3)은 DB 컬럼 체크(1~3)와 별개로
// "부모 depth+1" 관계를 여기서 검증한다(design.md 3.2: "depth 제약은 애플리케이션 레벨").

export async function createCategory(formData: FormData) {
  const name = (formData.get('name') as string | null)?.trim();
  const parentId = (formData.get('parentId') as string | null) || null;
  if (!name) redirect('/admin/categories?error=name-required');

  const supabase = await requireAdminClient();

  let depth: 1 | 2 | 3 = 1;
  if (parentId) {
    const { data: parent, error: parentError } = await supabase
      .from('categories')
      .select('depth')
      .eq('id', parentId)
      .maybeSingle();
    if (parentError || !parent) redirect('/admin/categories?error=failed');
    if (parent!.depth >= 3) redirect('/admin/categories?error=depth-exceeded');
    depth = (parent!.depth + 1) as 1 | 2 | 3;
  }

  let siblingQuery = supabase.from('categories').select('id', { count: 'exact', head: true });
  siblingQuery = parentId ? siblingQuery.eq('parent_id', parentId) : siblingQuery.is('parent_id', null);
  const { count } = await siblingQuery;

  const { error } = await supabase.from('categories').insert({ name, parent_id: parentId, depth, order: (count ?? 0) + 1 });
  if (error) redirect('/admin/categories?error=failed');
  redirect('/admin/categories?success=created');
}

export async function updateCategory(categoryId: string, formData: FormData) {
  const name = (formData.get('name') as string | null)?.trim();
  if (!name) redirect('/admin/categories?error=name-required');

  const supabase = await requireAdminClient();
  const { error } = await supabase.from('categories').update({ name }).eq('id', categoryId);
  if (error) redirect('/admin/categories?error=failed');
  redirect('/admin/categories?success=updated');
}

async function swapOrder(categoryId: string, direction: 'up' | 'down') {
  const supabase = await requireAdminClient();
  const { data: current, error: currentError } = await supabase
    .from('categories')
    .select('id, parent_id, order')
    .eq('id', categoryId)
    .maybeSingle();
  if (currentError || !current) redirect('/admin/categories?error=failed');

  let siblingsQuery = supabase.from('categories').select('id, order').order('order', { ascending: true });
  siblingsQuery = current!.parent_id ? siblingsQuery.eq('parent_id', current!.parent_id) : siblingsQuery.is('parent_id', null);
  const { data: siblings, error: siblingsError } = await siblingsQuery;
  if (siblingsError || !siblings) redirect('/admin/categories?error=failed');

  const idx = siblings!.findIndex((s) => s.id === categoryId);
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= siblings!.length) redirect('/admin/categories');

  const target = siblings![targetIdx];
  await supabase.from('categories').update({ order: target.order }).eq('id', categoryId);
  await supabase.from('categories').update({ order: current!.order }).eq('id', target.id);
  redirect('/admin/categories?success=reordered');
}

export async function moveCategoryUp(categoryId: string) {
  await swapOrder(categoryId, 'up');
}

export async function moveCategoryDown(categoryId: string) {
  await swapOrder(categoryId, 'down');
}

// formData의 current는 토글 직전 화면에 보이던 값 — 원자적 조건부 update로 더블클릭/동시
// 변경 경쟁을 막는다.
export async function toggleCategoryActive(categoryId: string, formData: FormData) {
  const current = formData.get('current') === 'true';
  const supabase = await requireAdminClient();
  const { data, error } = await supabase
    .from('categories')
    .update({ is_active: !current })
    .eq('id', categoryId)
    .eq('is_active', current)
    .select();

  if (error) redirect('/admin/categories?error=failed');
  if (!data || data.length === 0) redirect('/admin/categories?error=already-processed');
  redirect('/admin/categories?success=updated');
}

export async function deleteCategory(categoryId: string) {
  const childCount = await getCategoryChildCount(categoryId);
  if (childCount > 0) redirect('/admin/categories?error=has-children');

  const supabase = await requireAdminClient();
  const { count, error: countError } = await supabase
    .from('courses')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId);
  if (countError) redirect('/admin/categories?error=failed');
  if ((count ?? 0) > 0) redirect('/admin/categories?error=has-courses');

  const { error } = await supabase.from('categories').delete().eq('id', categoryId);
  if (error) redirect('/admin/categories?error=failed');
  redirect('/admin/categories?success=deleted');
}
