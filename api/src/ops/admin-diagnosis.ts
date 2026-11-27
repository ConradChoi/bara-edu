import { z } from 'zod';
import type { Tx } from '../db/context.js';
import { MEMO_DATETIME_RE, memoHasPii } from './admin-profile.js';
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

// 휴대전화·이메일 가림 규칙(2026-11-27 강화, 개인정보 점검 R-1·R-2).
// 휴대전화: 숫자·공백·하이픈·괄호·점·+ 외 글자가 섞이면(아이디·생년월일 등 다른 정보) 통째로 '***'.
//   숫자 11자리 이상(휴대전화 010-1234-5678 등)은 앞 3 + 뒤 4, 9~10자리(유선 02-123-4567 등)는 앞 2 + 뒤 2, 9자리 미만은 '***'.
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '-';
  if (/[^0-9\s\-+().]/.test(phone)) return '***';
  // 주민등록번호 모양(생년월일 6 + 성별 1~8로 시작하는 7)이면 통째로 가린다(R-6). 휴대전화는 0으로 시작해 겹치지 않는다.
  if (/^\s*\d{6}[-\s]?[1-8]\d{6}\s*$/.test(phone)) return '***';
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length >= 11) return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  if (digits.length >= 9) return `${digits.slice(0, 2)}-****-${digits.slice(-2)}`;
  return '***';
}

// 이메일: 공백이 있거나 @가 하나가 아니거나 도메인이 도메인 모양이 아니면(휴대전화를 함께 적은 값 등) 통째로 '***'.
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '-';
  const t = email.trim();
  const at = t.indexOf('@');
  if (at <= 0 || /\s/.test(t) || t.indexOf('@', at + 1) !== -1) return '***';
  const local = t.slice(0, at);
  const domain = t.slice(at + 1);
  // 도메인은 영문 TLD로 끝나는 라벨 모양이어야 하고, 숫자가 7개 이상이면 번호를 이어 붙인 값으로 보고 가린다(R-5).
  if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(domain) || (domain.match(/[0-9]/g)?.length ?? 0) >= 7) return '***';
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

// ---------------- 강사과정 문의 목록(이름·연락처 가림, 2026-11-27) ----------------
// 앱이 diagnosis_leads를 직접 select하던 방식을 이 op로 바꿨다(관리자 select 정책 제거, QA minor 2).
// 목록은 이름·연락처를 가려서 내려 주고, 앱이 reveal 토큰(HMAC)을 검증한 revealId 한 행만 원문 + 접속 기록('조회')을
// 한 트랜잭션으로 남긴다. 기록이 실패하면 OpError(503 log_failed)로 끝나 원문이 응답에 실리지 않는다.

// 연락처는 "휴대전화 또는 이메일" 자유 입력 한 칸이라 @ 포함 여부로 규칙을 고른다(2026-11-27 전 앱의 maskContact를 옮기면서 규칙을 강화했다).
export function maskContact(contact: string | null | undefined): string {
  if (!contact) return '-';
  return contact.includes('@') ? maskEmail(contact) : maskPhone(contact);
}

// 문의 내용(message) 목록 미리보기(2026-11-27 대표 결정 R-3 B안): 문의자가 직접 쓰는 칸이라 연락처·상담 사정이 들어갈 수 있다.
// 목록에는 앞 MESSAGE_PREVIEW_LEN자만, 이메일·전화번호·주민번호 모양은 '***'로 바꿔 내려 주고 전문은 [개인정보 보기] 행에서만(접속 기록 fields에 message).
export const MESSAGE_PREVIEW_LEN = 40;
const PREVIEW_EMAIL_RE = /\S+\s*@\s*\S+|\S+\s*[(\[]\s*at\s*[)\]]\s*\S+/gi;
const PREVIEW_INTL_RE = /\+\s*\d[\d\s\-.()]*/g;
const PREVIEW_DIGITS_RE = /\d[\d\s\-.()/:]*\d/g;
export function maskMessagePreview(message: string | null | undefined): { text: string | null; masked: boolean } {
  if (message == null) return { text: null, masked: false };
  const full = message.normalize('NFKC').replace(/\s+/g, ' ').trim();
  let t = full
    .replace(PREVIEW_EMAIL_RE, '***')
    .replace(PREVIEW_INTL_RE, '***')
    // 숫자가 7개 이상 이어진 덩어리(전화·계좌·주민번호)는 가린다. 날짜·시각(2026-11-26, 14:12) 한 개뿐이면 둔다.
    .replace(PREVIEW_DIGITS_RE, (m) => ((m.match(/\d/g)?.length ?? 0) >= 7 && m.replace(MEMO_DATETIME_RE, '').replace(/[\s\-.()/:]/g, '') !== '' ? '***' : m));
  const chars = Array.from(t);
  if (chars.length > MESSAGE_PREVIEW_LEN) t = `${chars.slice(0, MESSAGE_PREVIEW_LEN).join('')}…`;
  // 위 규칙을 빠져나간 모양이 남아 있으면 미리보기 전체를 가린다(안전 쪽).
  if (memoHasPii(t)) t = '***';
  return { text: t, masked: t !== full };
}

type LeadListRow = {
  id: string; created_at: Date; result_id: string | null; name: string; contact: string; message: string | null;
  status: string; admin_note: string | null; handled_at: Date | null; user_id: string | null;
};

export const adminListDiagnosisLeads = defineOp({
  name: 'admin.listDiagnosisLeads',
  access: 'service',
  params: z
    .object({
      status: z.enum(['all', 'new', 'contacted', 'closed']).optional(),
      revealId: z.string().uuid().optional(),
    })
    .strict(),
  async run({ tx, userId, ip, warn }, p) {
    if (!userId || !(await isAdmin(tx, userId))) {
      warn('admin.listDiagnosisLeads forbidden');
      return { result: 'forbidden' };
    }
    const values: unknown[] = [];
    let where = '';
    if (p.status && p.status !== 'all') {
      values.push(p.status);
      where = 'where status = $1::diagnosis_lead_status';
    }
    const r = await tx.query<LeadListRow>(
      `select id, created_at, result_id, name, contact, message, status, admin_note, handled_at, user_id
         from diagnosis_leads ${where}
        order by created_at desc, id`,
      values,
    );

    const target = p.revealId ? r.rows.find((x) => x.id === p.revealId) : undefined;
    if (target) await writeLog(tx, userId, target.user_id, REVEAL_LOG_ACTION, `강사과정 문의 이름·연락처 열람(${target.id}) fields=name,contact,message`, ip);

    return {
      result: 'ok',
      rows: r.rows.map((row) => {
        const isRevealed = row === target;
        const preview = isRevealed ? { text: row.message, masked: false } : maskMessagePreview(row.message);
        return {
          id: row.id,
          createdAt: row.created_at.toISOString(),
          resultId: row.result_id,
          name: isRevealed ? row.name : maskName(row.name),
          contact: isRevealed ? row.contact : maskContact(row.contact),
          isRevealed,
          message: preview.text,
          messageMasked: preview.masked,
          status: row.status,
          adminNote: row.admin_note,
          handledAt: row.handled_at ? row.handled_at.toISOString() : null,
          userId: row.user_id,
        };
      }),
    };
  },
});
