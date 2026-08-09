import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createNewVersion, publishVersion, unpublishVersion } from '@/app/actions/admin-cms';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { getLegalDocumentById } from '@/lib/supabase/admin-queries';

export const metadata: Metadata = { title: '문서 편집 | 관리자' };

const SUCCESS_MESSAGE: Record<string, string> = {
  created: '문서를 만들었어요. 아직 게시되지 않았어요.',
  versionCreated: '새 버전을 만들었어요. 아직 게시되지 않았어요.',
  published: '게시했어요.',
  unpublished: '게시를 중단했어요.',
};

const ERROR_MESSAGE: Record<string, string> = {
  validation: '제목과 본문을 모두 입력해주세요.',
  failed: '처리에 실패했어요. 잠시 후 다시 시도해주세요.',
};

export default async function EditLegalDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const doc = await getLegalDocumentById(id);
  if (!doc) notFound();

  const message = Object.keys(SUCCESS_MESSAGE).find((key) => search[key]);
  const errorMessage = search.error ? ERROR_MESSAGE[search.error] ?? ERROR_MESSAGE.failed : undefined;

  return (
    <div className="flex max-w-[720px] flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-n-9">
          {doc.title} · v{doc.version}
        </h1>
        {doc.isPublished ? (
          <ConfirmDialog
            triggerLabel="게시중단"
            triggerClassName="rounded-pill border border-danger px-3 py-1.5 text-[12px] font-medium text-danger"
            title="게시를 중단할까요?"
            description="공개 페이지(/legal/...)에서 404로 표시돼요."
            confirmLabel="게시중단"
            tone="danger"
            action={unpublishVersion.bind(null, doc.id)}
          />
        ) : (
          <ConfirmDialog
            triggerLabel="이 버전 게시"
            title="이 버전을 게시할까요?"
            description="같은 slug의 다른 버전은 자동으로 게시 해제돼요."
            confirmLabel="게시"
            action={publishVersion.bind(null, doc.id)}
          />
        )}
      </div>

      {message && (
        <div className="rounded-md border border-success bg-success/10 px-3.5 py-3 text-[13px] font-medium text-success">
          {SUCCESS_MESSAGE[message]}
        </div>
      )}

      {errorMessage && (
        <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          {errorMessage}
        </div>
      )}

      <p className="text-[12px] text-n-5">
        /legal/{doc.slug} · {doc.isPublished ? '게시중' : '미게시'} · 작성일 {new Date(doc.createdAt).toLocaleDateString('ko-KR')}
      </p>

      <div className="rounded-lg border border-n-3 bg-n-0 p-5">
        <p className="text-[12.5px] font-medium text-n-7">현재 내용 (읽기 전용)</p>
        <div className="mt-2 max-h-[300px] overflow-y-auto whitespace-pre-wrap rounded-md border border-n-2 bg-n-1 p-3 text-[12.5px] text-n-7">
          {doc.content}
        </div>
      </div>

      <div className="rounded-lg border border-n-3 bg-n-0 p-5">
        <p className="text-[12.5px] font-medium text-n-7">
          내용을 수정하려면 새 버전을 만드세요 (기존 v{doc.version}은 이력으로 보존돼요)
        </p>
        <form action={createNewVersion.bind(null, doc.slug, doc.id)} className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
            제목
            <input name="title" defaultValue={doc.title} required className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]" />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
            본문
            <textarea
              name="content"
              defaultValue={doc.content}
              required
              className="min-h-[240px] rounded-md border border-n-3 bg-n-1 p-2.5 text-[13px]"
            />
          </label>
          <button type="submit" className="h-11 self-start rounded-pill bg-pink px-5 text-[13px] font-semibold text-white">
            새 버전(v{doc.version + 1}) 만들기
          </button>
        </form>
      </div>
    </div>
  );
}
