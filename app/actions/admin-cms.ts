'use server';

import { redirect } from 'next/navigation';
import { requireAdminClient } from '@/lib/supabase/require-admin';
import type { LegalDocType } from '@/lib/types';

// 약관·정책 CMS (F-CMS-1~3). "수정"은 기존 행을 덮어쓰지 않고 새 버전 행을 추가하는
// 방식으로 이력을 보존한다(F-CMS-2). 게시는 같은 slug의 다른 버전을 자동으로 게시
// 해제해야 하므로 supabase/schema.sql의 publish_legal_document() RPC로 원자적으로 처리한다.

export async function createLegalDocument(formData: FormData) {
  const type = formData.get('type') as LegalDocType | null;
  const slug = (formData.get('slug') as string | null)?.trim();
  const title = (formData.get('title') as string | null)?.trim();
  const content = (formData.get('content') as string | null)?.trim();
  if (!type || !slug || !title || !content) redirect('/admin/cms/new?error=validation');
  // <input pattern> 은 브라우저 검증일 뿐이라 서버에서도 확인한다(admin-courses.ts의
  // readCourseFields()와 동일 기준 — qa-reviewer 점검, 2026-08-08).
  if (!/^[a-z0-9-]+$/.test(slug!)) redirect('/admin/cms/new?error=validation');

  const supabase = await requireAdminClient();
  const { data, error } = await supabase
    .from('legal_documents')
    .insert({ type, slug, title, content, version: 1, is_published: false })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') redirect('/admin/cms/new?error=slug-taken');
    redirect('/admin/cms/new?error=failed');
  }
  redirect(`/admin/cms/${data!.id}/edit?created=1`);
}

export async function createNewVersion(slug: string, currentId: string, formData: FormData) {
  const title = (formData.get('title') as string | null)?.trim();
  const content = (formData.get('content') as string | null)?.trim();
  // 실패 시 목록(/admin/cms)이 아니라 편집 중이던 문서로 되돌려 입력 내용을 다시
  // 살펴볼 수 있게 한다 — 목록으로 보내면 어떤 문서에서 실패했는지 알 수 없었다
  // (qa-reviewer 점검, 2026-08-09).
  if (!title || !content) redirect(`/admin/cms/${currentId}/edit?error=validation`);

  const supabase = await requireAdminClient();
  // type은 hidden input(폼 위변조 가능)이 아니라 DB의 최신 버전에서 그대로 가져온다 —
  // 위변조된 type으로 같은 slug에 서로 다른 종류의 문서가 섞이는 것을 막는다
  // (qa-reviewer 점검, 2026-08-08).
  const { data: latest, error: latestError } = await supabase
    .from('legal_documents')
    .select('type, version')
    .eq('slug', slug)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError || !latest) redirect(`/admin/cms/${currentId}/edit?error=failed`);

  const { data, error } = await supabase
    .from('legal_documents')
    .insert({ type: latest!.type, slug, title, content, version: latest!.version + 1, is_published: false })
    .select('id')
    .single();

  if (error) redirect(`/admin/cms/${currentId}/edit?error=failed`);
  redirect(`/admin/cms/${data!.id}/edit?versionCreated=1`);
}

export async function publishVersion(id: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc('publish_legal_document', { doc_id: id });
  if (error) redirect(`/admin/cms/${id}/edit?error=failed`);
  redirect(`/admin/cms/${id}/edit?published=1`);
}

export async function unpublishVersion(id: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.from('legal_documents').update({ is_published: false }).eq('id', id);
  if (error) redirect(`/admin/cms/${id}/edit?error=failed`);
  redirect(`/admin/cms/${id}/edit?unpublished=1`);
}
