import CategoryPicker from '@/components/admin/CategoryPicker';
import type { Category, Course } from '@/lib/types';

// 강좌 등록(/admin/courses/new)과 수정(/admin/courses/[id])이 공유하는 폼 마크업.
export default function CourseForm({
  categories,
  action,
  defaultValues,
  submitLabel,
}: {
  categories: Category[];
  action: (formData: FormData) => void | Promise<void>;
  defaultValues?: Course;
  submitLabel: string;
}) {
  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border border-n-3 bg-n-0 p-5">
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
          강좌명
          <input
            name="title"
            required
            defaultValue={defaultValues?.title}
            className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
          slug (영문 소문자·숫자·하이픈)
          <input
            name="slug"
            required
            pattern="[a-z0-9-]+"
            title="영문 소문자, 숫자, 하이픈만 사용할 수 있어요"
            defaultValue={defaultValues?.slug}
            className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
          />
        </label>
      </div>

      <div className="flex flex-col gap-1 text-[12.5px] text-n-7">
        카테고리
        <CategoryPicker categories={categories} defaultCategoryId={defaultValues?.categoryId} />
      </div>

      <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
        소개
        <textarea
          name="description"
          defaultValue={defaultValues?.description}
          className="min-h-[80px] rounded-md border border-n-3 bg-n-1 p-2.5 text-[13px]"
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
          강사
          <input
            name="instructor"
            defaultValue={defaultValues?.instructor}
            className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
          상태
          <select
            name="status"
            defaultValue={defaultValues?.status ?? 'upcoming'}
            className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
          >
            <option value="upcoming">예정</option>
            <option value="active">진행중</option>
            <option value="closed">비활성</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
          수강료(원)
          <input
            name="fee"
            type="number"
            min={0}
            required
            defaultValue={defaultValues?.fee}
            className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
          정원
          <input
            name="seats"
            type="number"
            min={0}
            required
            defaultValue={defaultValues?.seats}
            className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-[12.5px] text-n-7">
        <input type="checkbox" name="governmentSupport" defaultChecked={defaultValues?.governmentSupport} className="h-4 w-4" />
        정부지원 대상
      </label>

      <button type="submit" className="h-11 rounded-pill bg-pink text-[14px] font-semibold text-white">
        {submitLabel}
      </button>
    </form>
  );
}
