import { z } from 'zod';
import { defineOp } from './registry.js';

const DELETE_TABLES = ['progress', 'quiz_submissions', 'assignment_submissions', 'course_exam_submissions', 'course_exam_attempt_resets', 'diagnosis_leads'];

export const accountWithdrawCleanup = defineOp({
  name: 'account.withdrawCleanup',
  access: 'service',
  params: z.object({}).strict(),
  async run({ tx, userId }) {
    if (!userId) throw new Error('session required');
    for (const t of DELETE_TABLES) await tx.query(`delete from "${t}" where user_id = $1`, [userId]);
    await tx.query('update diagnosis_results set respondent_name = null, phone = null, email = null, certificate_level = null where user_id = $1', [userId]);
    return { ok: true };
  },
});
