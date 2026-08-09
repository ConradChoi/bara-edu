import type { Metadata } from 'next';
import Link from 'next/link';
import { unpublishVersion } from '@/app/actions/admin-cms';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { getAdminLegalDocumentGroups } from '@/lib/supabase/admin-queries';

export const metadata: Metadata = { title: '약관·정책 CMS | 관리자' };

const ERROR_MESSAGE: Record<string, string> = {
  validation: '필수 항목을 확인해주세요.',
  failed: '처리 중 문제가 발생했어요.',
};

export default async function AdminCmsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const groups = await getAdminLegalDocumentGroups();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-n-9">약관·정책 CMS</h1>
        <Link href="/admin/cms/new" className="rounded-pill bg-pink px-4 py-2 text-[13px] font-semibold text-white">
          새 문서 추가
        </Link>
      </div>

      {error && ERROR_MESSAGE[error] && (
        <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          {ERROR_MESSAGE[error]}
        </div>
      )}

      {groups.length === 0 ? (
        <p className="text-[13px] text-n-6">등록된 문서가 없어요.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.slug} className="rounded-lg border border-n-3 bg-n-0 p-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[14px] font-semibold text-n-9">{g.title}</span>
                  <span className="text-[11.5px] text-n-5">
                    /legal/{g.slug} · 최신 v{g.latestVersion}
                    {g.publishedVersion ? ` · 게시중 v${g.publishedVersion}` : ' · 게시된 버전 없음'}
                  </span>
                </div>
              </div>
              <ul className="mt-3 flex flex-col gap-1.5">
                {g.versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between rounded-md border border-n-2 px-3 py-2 text-[12.5px]">
                    <span>
                      v{v.version} · {new Date(v.createdAt).toLocaleDateString('ko-KR')}
                      {v.isPublished && <span className="ml-2 rounded-pill bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">게시중</span>}
                    </span>
                    <div className="flex gap-1.5">
                      <Link href={`/admin/cms/${v.id}/edit`} className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7">
                        보기/새 버전
                      </Link>
                      {v.isPublished && (
                        <ConfirmDialog
                          triggerLabel="게시중단"
                          triggerClassName="rounded-pill border border-danger px-2.5 py-1 text-[11.5px] text-danger"
                          title="게시를 중단할까요?"
                          description="공개 페이지(/legal/...)에서 404로 표시돼요."
                          confirmLabel="게시중단"
                          tone="danger"
                          action={unpublishVersion.bind(null, v.id)}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
