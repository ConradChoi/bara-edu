import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import LegalVersionSelect from '@/components/legal/LegalVersionSelect';
import { getLegalDocument, getLegalDocumentVersions } from '@/lib/supabase/queries';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getLegalDocument(slug);
  return { title: doc ? `${doc.title} | 바라 평생교육원` : '문서를 찾을 수 없어요' };
}

// ?v=<version>으로 예전에 게시됐던 버전도 열람할 수 있다(대표 요청, 2026-09-15 — 지금까지는
// 새 버전을 게시하면 이전 버전이 어디서도 조회되지 않았다). 게시 이력이 1개뿐인 문서(예:
// 이용약관)는 버전 선택 자체가 무의미해 그 경우에는 아무 것도 렌더하지 않는다 — 개인정보
// 처리방침처럼 실제로 여러 버전이 게시된 적 있는 문서에서만 자연히 나타난다(대표 요청,
// 2026-09-15: "이용약관은 버전별로 볼 필요 없다").
export default async function LegalDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { slug } = await params;
  const { v } = await searchParams;
  const requestedVersion = v ? Number(v) : undefined;

  const [doc, versions] = await Promise.all([
    getLegalDocument(slug, requestedVersion),
    getLegalDocumentVersions(slug),
  ]);
  if (!doc) notFound();

  return (
    <div className="mx-auto max-w-[720px] px-6 py-10">
      <h1 className="text-[22px] font-semibold text-n-9">{doc.title}</h1>

      <div className="mt-6 whitespace-pre-wrap text-[13.5px] leading-relaxed text-n-7">{doc.content}</div>

      {versions.length > 1 && (
        <div className="mt-6 flex items-center gap-2 border-t border-n-2 pt-4">
          <span className="text-[12px] text-n-6">버전 선택</span>
          <LegalVersionSelect slug={slug} versions={versions} currentVersion={doc.version} />
        </div>
      )}
    </div>
  );
}
