import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
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
// 새 버전을 게시하면 이전 버전이 어디서도 조회되지 않았다). 링크 목록으로만 구현해
// 별도 클라이언트 컴포넌트 없이 정적으로 렌더한다(이 프로젝트의 "클라이언트 상태가
// 꼭 필요할 때만 client component" 원칙).
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
      <p className="mt-1 text-[12px] text-n-5">버전 {doc.version}</p>

      {versions.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {versions.map((ver) => (
            <Link
              key={ver.version}
              href={ver.isCurrent ? `/legal/${slug}` : `/legal/${slug}?v=${ver.version}`}
              className={`rounded-pill border px-3 py-1 text-[11.5px] font-medium ${
                doc.version === ver.version ? 'border-pink bg-pink/10 text-pink' : 'border-n-3 text-n-7'
              }`}
            >
              v{ver.version}
              {ver.isCurrent ? ' (현재)' : ''} · {new Date(ver.publishedAt).toLocaleDateString('ko-KR')}
            </Link>
          ))}
        </div>
      )}

      {doc.version !== versions.find((ver) => ver.isCurrent)?.version && (
        <p className="mt-3 rounded-md border border-warning bg-warning/10 px-3 py-2 text-[12px] font-medium text-warning">
          지금 보고 계신 버전은 과거에 게시됐던 버전이에요. 현재 적용 중인 최신 버전이 아닙니다.
        </p>
      )}

      <div className="mt-6 whitespace-pre-wrap text-[13.5px] leading-relaxed text-n-7">{doc.content}</div>
    </div>
  );
}
