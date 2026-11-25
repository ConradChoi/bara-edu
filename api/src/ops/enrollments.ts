import { z } from 'zod';
import { defineOp } from './registry.js';

export type ApplyResult = 'ok' | 'already_active' | 'closed' | 'full' | 'course_not_found' | 'inactive' | 'conflict';

// 수강 신청의 검증과 기록을 한 트랜잭션에서 한다(flows.md Q2·Q3). 강좌 행을 FOR UPDATE로 잠가
// 같은 강좌의 신청·모집 상태 변경이 겹치지 않게 하고, 잠근 뒤의 값(모집 상태, 정원)으로 판단한다.
// 정원은 승인(approved) 건수 기준이다(Q3: 정원 마감은 승인 시점). 신청(pending)은 자리를 잡지 않는다.
// 'service' 접근인 이유: FOR UPDATE는 강좌 수정 권한이 필요한데 학습자에게는 없다. 대상 회원은 항상 세션의 userId다.
export const enrollmentsApply = defineOp({
  name: 'enrollments.apply',
  access: 'service',
  params: z.object({ courseId: z.string().uuid() }).strict(),
  async run({ tx, userId }, { courseId }): Promise<{ result: ApplyResult }> {
    if (!userId) throw new Error('session required');

    const p = await tx.query<{ status: string }>('select status from profiles where id = $1', [userId]);
    if (p.rows[0]?.status !== 'active') return { result: 'inactive' };

    const c = await tx.query<{ status: string; seats: number }>('select status, seats from courses where id = $1 for update', [courseId]);
    if (c.rowCount === 0) return { result: 'course_not_found' };
    const course = c.rows[0];

    const e = await tx.query<{ id: string; status: string; overdue: boolean }>(
      'select id, status, (payment_due_at < now()) as overdue from enrollments where user_id = $1 and course_id = $2 for update',
      [userId, courseId],
    );
    const existing = e.rows[0];
    if (existing && (existing.status === 'approved' || (existing.status === 'pending' && !existing.overdue))) return { result: 'already_active' };

    if (!['active', 'upcoming'].includes(course.status)) return { result: 'closed' };
    const taken = await tx.query<{ n: number }>("select count(*)::int as n from enrollments where course_id = $1 and status = 'approved'", [courseId]);
    if (taken.rows[0].n >= course.seats) return { result: 'full' };

    if (existing) {
      const u = await tx.query(
        `update enrollments
            set status = 'pending', payment_due_at = now() + interval '3 days', created_at = now(), rejection_reason = null
          where id = $1 and status = $2`,
        [existing.id, existing.status],
      );
      return { result: u.rowCount === 0 ? 'conflict' : 'ok' };
    }
    await tx.query("insert into enrollments (user_id, course_id, status, payment_due_at) values ($1, $2, 'pending', now() + interval '3 days')", [userId, courseId]);
    return { result: 'ok' };
  },
});
