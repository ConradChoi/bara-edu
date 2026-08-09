import type { Metadata } from 'next';
import { createLegalDocument } from '@/app/actions/admin-cms';

export const metadata: Metadata = { title: '새 문서 추가 | 관리자' };

const ERROR_MESSAGE: Record<string, string> = {
  validation: '필수 항목을 확인해주세요.',
  'slug-taken': '이미 사용 중인 slug + 버전 조합이에요.',
  failed: '처리 중 문제가 발생했어요.',
};

export default async function NewLegalDocumentPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <h1 className="text-[20px] font-semibold text-n-9">새 문서 추가</h1>
      {error && ERROR_MESSAGE[error] && (
        <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          {ERROR_MESSAGE[error]}
        </div>
      )}
      <form action={createLegalDocument} className="flex flex-col gap-4 rounded-lg border border-n-3 bg-n-0 p-5">
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
            종류
            <select name="type" className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]">
              <option value="terms">이용약관</option>
              <option value="privacy">개인정보처리방침</option>
              <option value="refund_policy">환불정책</option>
              <option value="etc">기타</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
            slug (/legal/[slug])
            <input name="slug" required pattern="[a-z0-9-]+" className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
          제목
          <input name="title" required className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]" />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
          본문
          <textarea name="content" required className="min-h-[240px] rounded-md border border-n-3 bg-n-1 p-2.5 text-[13px]" />
        </label>
        <button type="submit" className="h-11 rounded-pill bg-pink text-[14px] font-semibold text-white">
          작성 (v1, 미게시)
        </button>
      </form>
    </div>
  );
}
