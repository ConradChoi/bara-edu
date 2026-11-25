import { z } from 'zod';
import { defineOp } from './registry.js';

export type ApproveResult = 'ok' | 'full' | 'already_processed' | 'not_found' | 'forbidden';

// 관리자 승인: 정원 마감은 승인 시점 기준이다(Q3). 강좌 행을 FOR UPDATE로 잠그고(enrollments.apply와 같은 순서: 강좌 -> 신청)
// 승인 인원을 센 뒤, 자리가 있을 때만 승인한다 — 마지막 자리를 두 관리자가 동시에 승인해도 정원을 넘지 않는다.
// 'service' 접근 + 앱 레벨 관리자 확인(role = 'admin') — 잠금(FOR UPDATE)에 강좌 수정 권한이 필요해서다.
export const enrollmentsApprove = defineOp({
  name: 'enrollments.approve',
  access: 'service',
  params: z.object({ enrollmentId: z.string().uuid() }).strict(),
  async run({ tx, userId }, { enrollmentId }): Promise<{ result: ApproveResult }> {
    if (!userId) throw new Error('session required');
    const who = await tx.query<{ role: string }>('select role from profiles where id = $1', [userId]);
    if (who.rows[0]?.role !== 'admin') return { result: 'forbidden' };

    const found = await tx.query<{ course_id: string }>('select course_id from enrollments where id = $1', [enrollmentId]);
    if (found.rowCount === 0) return { result: 'not_found' };
    const courseId = found.rows[0].course_id;

    const c = await tx.query<{ seats: number }>('select seats from courses where id = $1 for update', [courseId]);
    // 잠금을 기다리는 동안 다른 관리자가 처리했을 수 있으므로 잠근 뒤에 신청 상태를 다시 읽는다
    const e = await tx.query<{ status: string }>('select status from enrollments where id = $1 for update', [enrollmentId]);
    if (e.rowCount === 0) return { result: 'not_found' };
    if (e.rows[0].status !== 'pending') return { result: 'already_processed' };

    const taken = await tx.query<{ n: number }>("select count(*)::int as n from enrollments where course_id = $1 and status = 'approved'", [courseId]);
    if (taken.rows[0].n >= c.rows[0].seats) return { result: 'full' };

    await tx.query("update enrollments set status = 'approved', approved_at = now(), rejection_reason = null where id = $1 and status = 'pending'", [enrollmentId]);
    return { result: 'ok' };
  },
});
