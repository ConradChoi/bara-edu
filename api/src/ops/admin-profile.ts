import { z } from 'zod';
import type { Tx } from '../db/context.js';
import { lockUserSignupIn } from '../auth/tokens.js';
import { defineOp, OpError } from './registry.js';

// 관리자 회원 상세의 이름·연락처 수정. 계약: docs/02-design/features/bara-edu-lms.admin-profile-edit.api.md
// 모든 업무 결과는 HTTP 200의 data.result로 돌려준다(enrollments.approve와 같다). 접속 기록이 실패하면 OpError(503)로 롤백한다.

export const PROFILE_EDIT_ACTION = '정보수정';
export const EDIT_REASONS = ['member_request', 'typo_fix', 'signup_attempt_value', 'other'] as const;
const WITHDRAWN_NAME = '탈퇴한 회원';
const NAME_MAX = 100;

type Fields = { name: string; phone: string | null };
type Validation = { result: 'validation'; field: string; reason: string };
const bad = (field: string, reason: string): Validation => ({ result: 'validation', field, reason });

// \p{Cs}: 짝 없는 서로게이트(DB 저장 때 500이 나므로 입력 단계에서 거절)
const CONTROL_RE = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u;
const PHONE_CHARS_RE = /^[0-9\s\-+()]+$/;

// 메모 개인정보 규칙(frontend도 같은 정의를 쓴다). 검사 전에 memo.normalize('NFKC')로 전각 숫자 등을 바꾼다.
// 아래 중 하나라도 맞으면 memo_has_pii. 날짜(2026-11-26, 숫자 8개)는 허용된다.
export const MEMO_STRIP_RE = /[\s\-.()]/g; // 이걸 모두 지운 문자열에서 숫자가 9개 이상 이어지면 거절(전화·계좌·주민번호)
export const MEMO_DIGITS_RE = /\d{9,}/;
export const MEMO_INTL_PHONE_RE = /\+\s*82/; // +82로 시작하는 국제 형식
export const MEMO_RRN_RE = /\d{6}\s*-?\s*[1-8]\d{6}/; // 주민번호 형태(위 규칙과 겹쳐도 명시)
export const MEMO_EMAIL_RE = /[^\s@]\s*@\s*[^\s@]|\S\s*[(\[]\s*at\s*[)\]]\s*\S/i; // @ 앞뒤 공백 허용, (at)·[at]

export function memoHasPii(memo: string): boolean {
  const m = memo.normalize('NFKC');
  return CONTROL_RE.test(m) || MEMO_DIGITS_RE.test(m.replace(MEMO_STRIP_RE, '')) || MEMO_INTL_PHONE_RE.test(m) || MEMO_RRN_RE.test(m) || MEMO_EMAIL_RE.test(m);
}

// 가입(auth/routes.ts signupBody: 이름 trim 2~100자)과 같은 규칙에 제어 문자·예약 이름 거절, 연속 공백 정리를 더했다.
export function checkName(raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  if (CONTROL_RE.test(raw)) return { ok: false, reason: 'name_control' };
  const value = raw.trim().replace(/\s{2,}/g, ' ');
  const len = [...value].length;
  if (len < 2 || len > NAME_MAX) return { ok: false, reason: 'name_length' };
  if (value === WITHDRAWN_NAME) return { ok: false, reason: 'name_reserved' };
  return { ok: true, value };
}

export function checkPhone(raw: string | null): { ok: true; value: string | null } | { ok: false; reason: string } {
  const value = (raw ?? '').trim();
  if (value === '') return { ok: true, value: null };
  if (value.includes('*')) return { ok: false, reason: 'phone_masked' };
  if (value.length < 7 || value.length > 30) return { ok: false, reason: 'phone_length' };
  if (!PHONE_CHARS_RE.test(value)) return { ok: false, reason: 'phone_chars' };
  if ((value.match(/\d/g)?.length ?? 0) < 7) return { ok: false, reason: 'phone_digits' };
  return { ok: true, value };
}

function checkMeta(p: { reason?: string; memo?: string | null; identityChecked?: boolean }): Validation | { memo: string | null } {
  if (!(EDIT_REASONS as readonly string[]).includes(p.reason ?? '')) return bad('reason', 'reason_required');
  if (p.identityChecked !== true) return bad('identityChecked', 'not_checked');
  const memo = (p.memo ?? '').trim();
  if (p.reason === 'other' && [...memo].length < 5) return bad('memo', 'memo_required');
  if ([...memo].length > 100) return bad('memo', 'memo_length');
  if (memo && memoHasPii(memo)) return bad('memo', 'memo_has_pii');
  return { memo: memo || null };
}

const params = z
  .object({
    memberId: z.string().uuid(),
    name: z.string().max(1000).optional(),
    phone: z.string().max(1000).nullable().optional(),
    expected: z.object({ name: z.string().max(1000).optional(), phone: z.string().max(1000).nullable().optional() }).strict(),
    reason: z.string().max(40).optional(),
    memo: z.string().max(1000).nullish(),
    identityChecked: z.boolean().optional(),
  })
  .strict();

async function isAdmin(tx: Tx, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const r = await tx.query<{ role: string }>('select role from profiles where id = $1', [userId]);
  return r.rows[0]?.role === 'admin';
}

// KST 표시용 시각: 2026년 11월 26일 오후 2시 12분
function kstStamp(d: Date): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: 'numeric', hour12: false }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const h = g('hour') % 24;
  return `${g('year')}년 ${g('month')}월 ${g('day')}일 ${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시 ${g('minute')}분`;
}

export const adminUpdateMemberProfile = defineOp({
  name: 'admin.updateMemberProfile',
  access: 'service',
  params,
  async run({ tx, userId, ip, queueMail, warn }, p) {
    if (!userId || !(await isAdmin(tx, userId))) {
      warn('admin.updateMemberProfile forbidden');
      return { result: 'forbidden' };
    }

    const meta = checkMeta(p);
    if ('result' in meta) return meta;
    if (p.name === undefined && p.phone === undefined) return bad('name', 'none');
    if ((p.name !== undefined && p.expected.name === undefined) || (p.phone !== undefined && p.expected.phone === undefined)) return bad('expected', 'expected_missing');

    // 락 순서: 토큰 -> 가입 시도 -> 사용자 -> profiles (탈퇴·가입 확정과 같은 방향)
    await lockUserSignupIn(tx, p.memberId);
    const u = await tx.query<{ confirmed: boolean; meta: Record<string, unknown> | null }>(
      'select email_confirmed_at is not null as confirmed, raw_user_meta_data as meta from auth.users where id = $1 for update',
      [p.memberId],
    );
    if (u.rowCount === 0) return { result: 'not_found' };
    const pr = await tx.query<{ name: string; phone: string | null; role: string; status: string; email: string | null }>(
      'select name, phone, role, status, email from profiles where id = $1 for update',
      [p.memberId],
    );
    if (pr.rowCount === 0) return { result: 'not_found' };
    const cur = pr.rows[0];
    if (cur.role === 'admin') return { result: 'target_is_admin' };
    if (cur.status === 'withdrawn') return { result: 'withdrawn' };
    if (!u.rows[0].confirmed) return { result: 'not_confirmed' };
    if (!cur.email) return { result: 'no_email' };

    // 바꾸지 않는 칸(요청 값이 현재 값과 글자까지 같음)은 검증하지 않는다: 가입 때 허용된 옛 값이 규칙을 못 지켜도 오류를 내지 않는다.
    const next: Partial<Fields> = {};
    if (p.name !== undefined && p.name !== cur.name) {
      const c = checkName(p.name);
      if (!c.ok) return bad('name', c.reason);
      next.name = c.value;
    }
    if (p.phone !== undefined && p.phone !== cur.phone) {
      const c = checkPhone(p.phone);
      if (!c.ok) return bad('phone', c.reason);
      next.phone = c.value;
    }
    const current = { name: cur.name, phone: cur.phone };
    const changed = (['name', 'phone'] as const).filter((f) => f in next && next[f] !== cur[f]);
    // 요청한 값이 이미 현재 값이면 성공(변경 없음·더블클릭·타임아웃 뒤 재시도): 기록·메일을 또 남기지 않는다
    if (changed.length === 0) return { result: 'unchanged', changed: [], profile: current };
    const stale = (['name', 'phone'] as const).some((f) => p[f] !== undefined && p.expected[f] !== cur[f]);
    if (stale) return { result: 'stale', current };

    const sets: string[] = [];
    const vals: unknown[] = [p.memberId];
    const metaOut: Record<string, unknown> = { ...(u.rows[0].meta ?? {}) };
    for (const f of changed) {
      vals.push(next[f]);
      sets.push(`${f} = $${vals.length}`);
      if (next[f] === null) delete metaOut[f];
      else metaOut[f] = next[f];
    }
    await tx.query(`update profiles set ${sets.join(', ')} where id = $1`, vals);
    await tx.query('update auth.users set raw_user_meta_data = $2::jsonb, updated_at = now() where id = $1', [p.memberId, JSON.stringify(metaOut)]);

    // 같은 트랜잭션: 이 insert가 실패하면 위 변경도 롤백된다. 값(이전·새 이름·전화)은 남기지 않는다.
    const detail = [`fields=${changed.join(',')}`, `reason=${p.reason}`, 'verified=email', ...(meta.memo ? [`memo=${encodeURIComponent(meta.memo)}`] : [])].join(';');
    try {
      await tx.query('insert into admin_access_logs (admin_id, target_user_id, action, detail, ip_address) values ($1, $2, $3, $4, $5)', [
        userId, p.memberId, PROFILE_EDIT_ACTION, detail, ip,
      ]);
    } catch {
      throw new OpError('unavailable', 'log_failed');
    }

    const profile = { name: next.name ?? cur.name, phone: 'phone' in next ? (next.phone ?? null) : cur.phone };
    let mailQueued = true;
    try {
      queueMail({ to: cur.email, template: 'profile_changed', fields: changed, at: kstStamp(new Date()) });
    } catch {
      mailQueued = false;
    }
    return { result: 'ok', changed, profile, mailQueued };
  },
});

const listParams = z.object({ memberId: z.string().uuid(), limit: z.number().int().min(1).max(50).optional() }).strict();

function parseDetail(detail: string | null): { fields: string[]; reason: string | null; memo: string | null } {
  const kv = new Map<string, string>();
  for (const part of (detail ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) kv.set(part.slice(0, i), part.slice(i + 1));
  }
  let memo: string | null = null;
  const rawMemo = kv.get('memo');
  if (rawMemo) {
    try {
      memo = decodeURIComponent(rawMemo);
    } catch {
      memo = null;
    }
  }
  return { fields: (kv.get('fields') ?? '').split(',').filter(Boolean), reason: kv.get('reason') ?? null, memo };
}

export const adminListMemberProfileEdits = defineOp({
  name: 'admin.listMemberProfileEdits',
  access: 'service',
  params: listParams,
  async run({ tx, userId, warn }, { memberId, limit }) {
    if (!userId || !(await isAdmin(tx, userId))) {
      warn('admin.listMemberProfileEdits forbidden');
      return { result: 'forbidden' };
    }
    const n = limit ?? 5;
    const r = await tx.query<{ created_at: Date; detail: string | null; admin_name: string | null; admin_status: string | null }>(
      `select l.created_at, l.detail, a.name as admin_name, a.status as admin_status
         from admin_access_logs l left join profiles a on a.id = l.admin_id
        where l.target_user_id = $1 and l.action = $2
        order by l.created_at desc, l.id desc limit $3`,
      [memberId, PROFILE_EDIT_ACTION, n + 1],
    );
    const items = r.rows.slice(0, n).map((row) => ({
      at: row.created_at.toISOString(),
      adminName: row.admin_status === 'withdrawn' ? null : row.admin_name,
      ...parseDetail(row.detail),
    }));
    return { result: 'ok', items, hasMore: r.rows.length > n };
  },
});
