import { z } from 'zod';
import type { Tx } from '../db/context.js';
import { memoHasPii } from './admin-profile.js';
import { defineOp, OpError } from './registry.js';

// 관리자 도형심리 진단 기능의 접속 기록 연동(처리방침 제8조 제5항).
//  - admin.updateDiagnosisLead: 강사과정 문의(리드)의 상태 전환·메모 수정. 변경과 접속 기록('수정')이 한 트랜잭션이다.
// 접속 기록 insert가 실패하면 OpError(503, log_failed)로 롤백한다 — 변경은 취소되고 조회 응답에는 원문이 실리지 않는다.
// 업무 결과는 HTTP 200의 data.result로 돌려준다(admin.updateMemberProfile과 같다).

export const LEAD_LOG_ACTION = '수정';
// 메모 길이 제한은 기존 동작(제한 없음)을 유지한다. 아래 값은 요청 본문 크기 방어용 상한일 뿐이다.
const NOTE_BODY_CAP = 5000;

async function isAdmin(tx: Tx, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const r = await tx.query<{ role: string }>('select role from profiles where id = $1', [userId]);
  return r.rows[0]?.role === 'admin';
}

async function writeLog(tx: Tx, adminId: string, targetUserId: string | null, action: string, detail: string, ip: string | null): Promise<void> {
  try {
    await tx.query('insert into admin_access_logs (admin_id, target_user_id, action, detail, ip_address) values ($1, $2, $3, $4, $5)', [adminId, targetUserId, action, detail, ip]);
  } catch {
    throw new OpError('unavailable', 'log_failed');
  }
}

const leadParams = z
  .object({
    leadId: z.string().uuid(),
    change: z.enum(['contacted', 'closed', 'note']),
    // contacted/closed에서 "이 상태일 때만 바꾼다"(두 관리자가 동시에 처리해도 한쪽만 성공). contacted는 항상 new에서만.
    fromStatus: z.enum(['new', 'contacted']).optional(),
    note: z.string().max(NOTE_BODY_CAP).nullish(),
  })
  .strict();

export const adminUpdateDiagnosisLead = defineOp({
  name: 'admin.updateDiagnosisLead',
  access: 'service',
  params: leadParams,
  async run({ tx, userId, ip, warn }, p) {
    if (!userId || !(await isAdmin(tx, userId))) {
      warn('admin.updateDiagnosisLead forbidden');
      return { result: 'forbidden' };
    }
    const note = (p.note ?? '').trim() || null;
    if (p.change === 'closed' && !note) return { result: 'validation', field: 'note', reason: 'reason_required' };
    // 여러 줄 입력(textarea)이므로 줄바꿈·탭은 공백으로 바꿔 검사한다(제어 문자 규칙이 줄바꿈을 거절하지 않게). 저장하는 값은 그대로다.
    if (note && memoHasPii(note.replace(/\s+/g, ' '))) return { result: 'validation', field: 'note', reason: 'memo_has_pii' };
    const from = p.change === 'contacted' ? 'new' : p.fromStatus;
    if (p.change === 'closed' && !from) return { result: 'validation', field: 'fromStatus', reason: 'required' };

    const cur = await tx.query<{ status: string; admin_note: string | null; user_id: string | null }>('select status, admin_note, user_id from diagnosis_leads where id = $1 for update', [p.leadId]);
    if (cur.rowCount === 0) return { result: 'not_found' };
    const row = cur.rows[0];

    let fields: string;
    if (p.change === 'note') {
      if ((row.admin_note ?? null) === note) return { result: 'unchanged' };
      await tx.query('update diagnosis_leads set admin_note = $2 where id = $1', [p.leadId, note]);
      fields = 'admin_note';
    } else {
      if (row.status !== from) return { result: 'already_processed' };
      await tx.query('update diagnosis_leads set status = $2, handled_by = $3, handled_at = now(), admin_note = $4 where id = $1', [p.leadId, p.change, userId, note]);
      fields = 'status,admin_note';
    }
    // 같은 트랜잭션: 실패하면 위 변경도 롤백된다. 리드 id와 바뀐 항목 이름만 남기고 값(메모·이름·연락처)은 남기지 않는다.
    await writeLog(tx, userId, row.user_id, LEAD_LOG_ACTION, `강사과정 문의 ${p.leadId} fields=${fields}`, ip);
    return { result: 'ok' };
  },
});

