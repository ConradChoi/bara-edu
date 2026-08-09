import { notFound, redirect } from 'next/navigation';
import ClassroomAccessNotice from '@/components/classroom/ClassroomAccessNotice';
import { getClassroomAccess, getCourseForClassroom, getLessonsForClassroom } from '@/lib/supabase/classroom-queries';
import { createClient } from '@/lib/supabase/server';

// 첫 강의로 리다이렉트하는 진입점. 미승인이면 접근 차단 안내(F-LRN-6)를 여기서 보여준다.
export default async function ClassroomEntryPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const course = await getCourseForClassroom(courseId);
  if (!course) notFound();

  const access = await getClassroomAccess(user.id, courseId);
  if (!access.allowed) {
    return <ClassroomAccessNotice reason={access.reason} />;
  }

  const lessons = await getLessonsForClassroom(courseId);
  if (lessons.length === 0) {
    return <p className="px-6 py-20 text-center text-[13px] text-n-6">아직 등록된 강의가 없어요</p>;
  }

  redirect(`/learn/${courseId}/${lessons[0].id}`);
}
