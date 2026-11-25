import 'server-only';
import { apiFetch } from './api';
import { readSession } from './session-cookie';

export type ApplyOutcome = 'ok' | 'already_active' | 'closed' | 'full' | 'course_not_found' | 'inactive' | 'conflict' | 'unauthenticated' | 'failed';

// 신청의 최종 검증(중복·모집 상태·정원)과 기록은 API가 강좌 행을 잠근 한 트랜잭션에서 한다.
export async function applyEnrollment(courseId: string): Promise<ApplyOutcome> {
  try {
    const r = await apiFetch<{ data: { result: ApplyOutcome } }>('/v1/op/enrollments.apply', {
      method: 'POST',
      session: await readSession(),
      body: { params: { courseId } },
    });
    if (r.ok) return r.data.data.result;
    return r.status === 401 && r.error.code === 'unauthenticated' ? 'unauthenticated' : 'failed';
  } catch {
    return 'failed';
  }
}
