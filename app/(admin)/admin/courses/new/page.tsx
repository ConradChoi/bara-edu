import type { Metadata } from 'next';
import { createCourse } from '@/app/actions/admin-courses';
import CourseForm from '@/components/admin/CourseForm';
import { getCategoryTree } from '@/lib/supabase/queries';

export const metadata: Metadata = { title: '강좌 등록 | 관리자' };

const ERROR_MESSAGE: Record<string, string> = {
  validation: '필수 항목을 확인해주세요 (slug는 영문 소문자·숫자·하이픈만 가능해요).',
  'slug-taken': '이미 사용 중인 slug예요.',
  failed: '처리 중 문제가 발생했어요.',
};

export default async function NewCoursePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const categories = await getCategoryTree();

  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <h1 className="text-[20px] font-semibold text-n-9">강좌 등록</h1>
      {error && ERROR_MESSAGE[error] && (
        <div className="rounded-md border border-danger bg-danger/10 px-3.5 py-3 text-[13px] font-medium text-danger">
          {ERROR_MESSAGE[error]}
        </div>
      )}
      <CourseForm categories={categories} action={createCourse} submitLabel="등록" />
    </div>
  );
}
