import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLegalDocument } from '@/lib/supabase/queries';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getLegalDocument(slug);
  return { title: doc ? `${doc.title} | 바라 평생교육원` : '문서를 찾을 수 없어요' };
}

export default async function LegalDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = await getLegalDocument(slug);
  if (!doc) notFound();

  return (
    <div className="mx-auto max-w-[720px] px-6 py-10">
      <h1 className="text-[22px] font-semibold text-n-9">{doc.title}</h1>
      <p className="mt-1 text-[12px] text-n-5">버전 {doc.version}</p>
      <div className="mt-6 whitespace-pre-wrap text-[13.5px] leading-relaxed text-n-7">{doc.content}</div>
    </div>
  );
}
