'use client';

import { useState } from 'react';
import CategoryPicker from '@/components/admin/CategoryPicker';
import type { Category, Course } from '@/lib/types';

// 강좌 등록(/admin/courses/new)과 수정(/admin/courses/[id])이 공유하는 폼 마크업.
// 카테고리가 "자격증"(F-ADMCAT-4)일 때만 시험 설정 블록을 실시간으로 보여줘야 해서
// 'use client'로 전환했다(2026-09-09) — action prop은 서버 액션 참조를 그대로 전달받아
// <form action={action}>에 연결하는 Next.js 공식 패턴이라 안전하다.
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
  const [level1, setLevel1] = useState<Category | null>(null);
  const [examEnabled, setExamEnabled] = useState(defaultValues?.requiresExam ?? false);
  const showExamBlock = level1?.isCertification === true;

  // 카테고리를 자격증→일반→자격증으로 왕복하면 시험 설정 fieldset은 언마운트·재마운트되지만
  // examEnabled state는 CourseForm(부모)이 들고 있어 그대로 유지된다 — 체크박스는
  // defaultChecked로 새로 true로 보이는데 정작 점수/횟수 입력란은 안 나타나는 모순이
  // 생겼다(qa-reviewer 지적, 2026-09-09). 자격증 카테고리로 진입할 때마다 저장된 값으로
  // 다시 동기화한다.
  function handleLevel1Change(category: Category | null) {
    setLevel1(category);
    if (category?.isCertification) {
      setExamEnabled(defaultValues?.requiresExam ?? false);
    }
  }

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
        <CategoryPicker categories={categories} defaultCategoryId={defaultValues?.categoryId} onLevel1Change={handleLevel1Change} />
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

      <div className="grid grid-cols-3 gap-4">
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
        <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
          총 강좌 시간(시간, 선택)
          <input
            name="totalHours"
            type="number"
            min={0}
            defaultValue={defaultValues?.totalHours ?? undefined}
            placeholder="예: 20"
            className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
          />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
          시작일(선택)
          <input
            name="startDate"
            type="date"
            defaultValue={defaultValues?.startDate ?? undefined}
            className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
          종료일(선택)
          <input
            name="endDate"
            type="date"
            defaultValue={defaultValues?.endDate ?? undefined}
            className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
          수업 요일(선택)
          <select
            name="scheduleType"
            defaultValue={defaultValues?.scheduleType ?? ''}
            className="h-10 rounded-md border border-n-3 bg-n-1 px-2.5 text-[13px]"
          >
            <option value="">선택 안 함</option>
            <option value="weekday">평일반</option>
            <option value="weekend">주말반</option>
            <option value="both">평일+주말반</option>
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-[12.5px] text-n-7">
        <input type="checkbox" name="governmentSupport" defaultChecked={defaultValues?.governmentSupport} className="h-4 w-4" />
        정부지원 대상
      </label>

      <label className="flex items-center gap-2 text-[12.5px] text-n-7">
        <input
          type="checkbox"
          name="requiresCertificateInfo"
          defaultChecked={defaultValues ? defaultValues.requiresCertificateInfo : true}
          className="h-4 w-4"
        />
        수강신청 시 주소·자격증 사진 필수 입력 (자격과정이 아니면 체크 해제)
      </label>

      {showExamBlock && (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-n-3 bg-n-1 p-4">
          <label className="flex items-center gap-2 text-[12.5px] text-n-7">
            <input
              type="checkbox"
              name="requiresExam"
              checked={examEnabled}
              onChange={(e) => setExamEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            자격시험 응시 필요
          </label>
          {examEnabled && (
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
                합격 기준 점수(%)
                <input
                  name="examPassScore"
                  type="number"
                  min={1}
                  max={100}
                  required
                  defaultValue={defaultValues?.examPassScore ?? 60}
                  className="h-10 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
                최대 응시 횟수
                <input
                  name="examMaxAttempts"
                  type="number"
                  min={1}
                  required
                  defaultValue={defaultValues?.examMaxAttempts ?? 3}
                  className="h-10 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]"
                />
              </label>
            </div>
          )}
        </fieldset>
      )}

      <button type="submit" className="h-11 rounded-pill bg-pink text-[14px] font-semibold text-white">
        {submitLabel}
      </button>
    </form>
  );
}
