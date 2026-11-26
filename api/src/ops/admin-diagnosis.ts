import { z } from 'zod';
import type { Tx } from '../db/context.js';
import { memoHasPii } from './admin-profile.js';
import { defineOp, OpError } from './registry.js';

// 관리자 도형심리 진단 기능의 접속 기록 연동(처리방침 제8조 제5항).
//  - admin.updateDiagnosisLead: 강사과정 문의(리드)의 상태 전환·메모 수정. 변경과 접속 기록('수정')이 한 트랜잭션이다.
//  - admin.getDiagnosisResultDetail: 진단 결과 상세 원문 조회. 조회와 접속 기록('조회')이 한 트랜잭션이다.
//  - admin.listDiagnosisResults: 진단 결과 목록. 이름·연락처는 가려서 내려 주고, revealId 한 행만 원문 + 접속 기록('조회')을 한 트랜잭션으로.
// 접속 기록 insert가 실패하면 OpError(503, log_failed)로 롤백한다 — 변경은 취소되고 조회 응답에는 원문이 실리지 않는다.
// 업무 결과는 HTTP 200의 data.result로 돌려준다(admin.updateMemberProfile과 같다).

export const LEAD_LOG_ACTION = '수정';
export const DETAIL_LOG_ACTION = '조회';
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
    let to = '';
    if (p.change === 'note') {
      if ((row.admin_note ?? null) === note) return { result: 'unchanged' };
      await tx.query('update diagnosis_leads set admin_note = $2 where id = $1', [p.leadId, note]);
      fields = 'admin_note';
    } else {
      if (row.status !== from) return { result: 'already_processed' };
      await tx.query('update diagnosis_leads set status = $2, handled_by = $3, handled_at = now(), admin_note = $4 where id = $1', [p.leadId, p.change, userId, note]);
      fields = 'status,admin_note';
      to = `;to=${p.change}`;
    }
    // 같은 트랜잭션: 실패하면 위 변경도 롤백된다. 리드 id, 바뀐 항목 이름, 전환 이름(to=contacted|closed)만 남기고 값(메모·이름·연락처)은 남기지 않는다.
    await writeLog(tx, userId, row.user_id, LEAD_LOG_ACTION, `강사과정 문의 ${p.leadId} fields=${fields}${to}`, ip);
    return { result: 'ok' };
  },
});

type ResultRow = {
  id: string; created_at: Date; respondent_name: string | null; phone: string | null; email: string | null; learning_experience: string;
  total_score: string | number; recommended_tier: string; user_id: string | null;
  score_theory: number; score_reading: number; score_analysis: number; score_counseling: number; score_case_record: number; score_teaching: number;
  strength_areas: string[] | null; improvement_areas: string[] | null;
  sensitive_consent_version: string | null; sensitive_consented_at: Date | null; consent_privacy_doc_version: number | null;
};

export const adminGetDiagnosisResultDetail = defineOp({
  name: 'admin.getDiagnosisResultDetail',
  access: 'service',
  params: z.object({ id: z.string().uuid() }).strict(),
  async run({ tx, userId, ip, warn }, { id }) {
    if (!userId || !(await isAdmin(tx, userId))) {
      warn('admin.getDiagnosisResultDetail forbidden');
      return { result: 'forbidden' };
    }
    const r = await tx.query<ResultRow>(
      `select id, created_at, respondent_name, phone, email, learning_experience, total_score, recommended_tier, user_id,
              score_theory, score_reading, score_analysis, score_counseling, score_case_record, score_teaching, strength_areas, improvement_areas,
              sensitive_consent_version, sensitive_consented_at, consent_privacy_doc_version
         from diagnosis_results where id = $1`,
      [id],
    );
    if (r.rowCount === 0) return { result: 'not_found' };
    const row = r.rows[0];
    const a = await tx.query<{ item_code: string; score: number }>('select item_code, score from diagnosis_answers where result_id = $1 order by item_code asc', [id]);

    // 기록이 먼저 성공해야 응답이 나간다. 실패하면 OpError로 트랜잭션이 끝나고 위 조회 결과는 응답에 실리지 않는다.
    await writeLog(tx, userId, row.user_id, DETAIL_LOG_ACTION, `진단 결과 상세(${id})`, ip);

    return {
      result: 'ok',
      id: row.id,
      createdAt: row.created_at.toISOString(),
      respondentName: row.respondent_name,
      phone: row.phone,
      email: row.email,
      learningExperience: row.learning_experience,
      totalScore: Number(row.total_score),
      recommendedTier: row.recommended_tier,
      userId: row.user_id,
      scoreTheory: row.score_theory,
      scoreReading: row.score_reading,
      scoreAnalysis: row.score_analysis,
      scoreCounseling: row.score_counseling,
      scoreCaseRecord: row.score_case_record,
      scoreTeaching: row.score_teaching,
      strengthAreas: row.strength_areas ?? [],
      improvementAreas: row.improvement_areas ?? [],
      answers: a.rows.map((x) => ({ itemCode: x.item_code, score: x.score })),
      // 동의 기록(API 계약 C5). 정리 스크립트 뒤에는 민감정보 동의 두 값이 항상 있다.
      sensitiveConsentVersion: row.sensitive_consent_version,
      sensitiveConsentedAt: row.sensitive_consented_at ? row.sensitive_consented_at.toISOString() : null,
      privacyDocVersion: row.consent_privacy_doc_version,
    };
  },
});

// ---------------- 진단 결과 목록(이름 가림, API 계약 C4) ----------------

export const REVEAL_LOG_ACTION = '조회';

// 이름: 첫 글자 + '**'(글자 수와 무관, SC-ADM-MASK-FORMAT). 첫 글자는 코드 포인트 기준(확장 한자 등이 반쪽으로 잘리지 않게).
export function maskName(name: string | null | undefined): string {
  const t = (name ?? '').trim();
  if (!t) return '-';
  return `${Array.from(t)[0]}**`;
}

// 휴대전화·이메일 가림 규칙은 앱(lib/supabase/admin-queries.ts의 maskPhone·maskEmail)이 쓰던 것과 같다.
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '-';
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length < 7) return '***';
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return '-';
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length <= 2) return `***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

const TIERS = ['level2', 'level1', 'supervision', 'instructor_candidate'] as const;

type ListRow = {
  id: string; created_at: Date; respondent_name: string | null; phone: string | null; email: string | null;
  learning_experience: string; total_score: string | number; recommended_tier: string; user_id: string | null;
};

export const adminListDiagnosisResults = defineOp({
  name: 'admin.listDiagnosisResults',
  access: 'service',
  params: z
    .object({
      tier: z.enum(['all', ...TIERS]).optional(),
      memberOnly: z.enum(['all', 'member', 'non_member']).optional(),
      // 앱이 reveal 토큰(HMAC)을 검증한 뒤에만 넘긴다. 이 행만 원문으로 내려 주고 같은 트랜잭션에서 접속 기록을 남긴다.
      revealId: z.string().uuid().optional(),
    })
    .strict(),
  async run({ tx, userId, ip, warn }, p) {
    if (!userId || !(await isAdmin(tx, userId))) {
      warn('admin.listDiagnosisResults forbidden');
      return { result: 'forbidden' };
    }
    const where: string[] = [];
    const values: unknown[] = [];
    if (p.tier && p.tier !== 'all') {
      values.push(p.tier);
      where.push(`recommended_tier = $${values.length}::diagnosis_tier`);
    }
    if (p.memberOnly === 'member') where.push('user_id is not null');
    if (p.memberOnly === 'non_member') where.push('user_id is null');
    const r = await tx.query<ListRow>(
      `select id, created_at, respondent_name, phone, email, learning_experience, total_score, recommended_tier, user_id
         from diagnosis_results ${where.length ? `where ${where.join(' and ')}` : ''}
        order by created_at desc, id`,
      values,
    );

    // 원문을 내려 줄 행은 이번 목록 안에 있어야 한다(필터 밖 행·없는 행은 아무것도 열지 않고 기록도 남기지 않는다).
    const target = p.revealId ? r.rows.find((x) => x.id === p.revealId) : undefined;
    // 기록이 먼저 성공해야 응답이 나간다. 실패하면 OpError(503 log_failed)로 끝나 원문이 응답에 실리지 않는다.
    if (target) await writeLog(tx, userId, target.user_id, REVEAL_LOG_ACTION, `진단 결과 개인정보 열람(${target.id}) fields=name,contact`, ip);

    return {
      result: 'ok',
      rows: r.rows.map((row) => {
        const isRevealed = row === target;
        return {
          id: row.id,
          createdAt: row.created_at.toISOString(),
          respondentName: isRevealed ? (row.respondent_name ?? '-') : maskName(row.respondent_name),
          phone: isRevealed ? (row.phone ?? '-') : maskPhone(row.phone),
          email: isRevealed ? (row.email ?? '-') : maskEmail(row.email),
          isRevealed,
          learningExperience: row.learning_experience,
          totalScore: Number(row.total_score),
          recommendedTier: row.recommended_tier,
          userId: row.user_id,
        };
      }),
    };
  },
});
