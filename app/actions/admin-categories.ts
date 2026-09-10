'use server';

import { redirect } from 'next/navigation';
import { requireAdminClient } from '@/lib/supabase/require-admin';
import { getCategoryChildCount } from '@/lib/supabase/admin-queries';
import { collectDescendantIds, getCategoryTree } from '@/lib/supabase/queries';

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

// F-ADMCAT-4: "자격증" 카테고리 플래그. 1Depth에서만 의미가 있으므로, 카테고리 관리
// 화면이 depth===1인 노드에만 토글 버튼을 보여주더라도 서버에서 다시 확인한다(클라이언트
// 조건은 신뢰하지 않는다는 기존 원칙 — depth-exceeded 검증과 동일한 이유).
export async function toggleCategoryCertification(categoryId: string, formData: FormData) {
  const current = formData.get('current') === 'true';
  const supabase = await requireAdminClient();

  const { data: category, error: categoryError } = await supabase
    .from('categories')
    .select('depth')
    .eq('id', categoryId)
    .maybeSingle();
  if (categoryError || !category) redirect('/admin/categories?error=failed');
  if (category!.depth !== 1) redirect('/admin/categories?error=failed');

  const { data, error } = await supabase
    .from('categories')
    .update({ is_certification: !current })
    .eq('id', categoryId)
    .eq('is_certification', current)
    .select();

  if (error) redirect('/admin/categories?error=failed');
  if (!data || data.length === 0) redirect('/admin/categories?error=already-processed');

  // 자격증 지정을 끌 때(true→false)만 하위 카테고리 강좌들의 시험 설정을 함께 정규화한다.
  // 그대로 두면 courses.requires_exam=true가 고아 상태로 남아 — 문항 저작 화면 진입 경로
  // (카테고리가 자격증일 때만 노출)는 사라졌는데 학습자는 계속 시험 합격을 요구받는
  // 상태가 된다(qa-reviewer/privacy-security-officer 공통 지적, 2026-09-09). 문항·응시
  // 기록 자체는 지우지 않는다 — 다시 켜면 그대로 복구되어야 한다(F-ADMC-7~9 제약 #2).
  if (current) {
    const categories = await getCategoryTree();
    const descendantIds = collectDescendantIds(categoryId, categories);
    await supabase
      .from('courses')
      .update({ requires_exam: false, exam_pass_score: null, exam_max_attempts: null })
      .in('category_id', descendantIds);
  }

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
