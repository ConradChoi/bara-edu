// 관리자 회원 상세 "이름·연락처 수정" 화면의 순수 로직(검증, 문구, 상태 전이).
// 서버 액션과 클라이언트 컴포넌트가 함께 쓴다 — server-only를 import하지 않는다.
// 문구 출처: docs/02-design/features/bara-edu-lms.admin-profile-edit-copy.md (정의서 10장 초안보다 우선)

export type EditReason = 'member_request' | 'typo_fix' | 'signup_attempt_value' | 'other';
export type Values = { name: string; phone: string | null };
export type FieldKey = 'name' | 'phone' | 'reason' | 'memo' | 'verified';
export type LockedWhy = 'withdrawn' | 'not_confirmed' | 'target_is_admin' | 'no_email' | 'unknown_confirm';

export const REASONS: readonly EditReason[] = ['member_request', 'typo_fix', 'signup_attempt_value', 'other'];
export const REASON_LABEL: Record<EditReason, string> = {
  member_request: '회원 요청',
  typo_fix: '오기 정정',
  signup_attempt_value: '가입 때 다른 사람이 입력한 값 정정',
  other: '기타',
};

export const LIMITS = { nameMin: 2, nameMax: 100, phoneMin: 7, phoneMax: 30, memoMin: 5, memoMax: 100 } as const;

// ---------- 서버 액션 입출력 ----------

export type ProfileSaveInput = {
  name: string;
  phone: string;
  expected: Values; // 편집을 연 시점의 값
  reason: EditReason;
  memo: string;
  identityChecked: boolean;
};

export type SaveOutcome =
  | { status: 'ok'; changed: ('name' | 'phone')[]; profile: Values; mailQueued: boolean }
  | { status: 'unchanged'; profile: Values }
  | { status: 'stale'; current: Values }
  | { status: 'validation'; field: FieldKey | 'none'; code?: string }
  | { status: 'locked'; why: Exclude<LockedWhy, 'unknown_confirm'> }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'log_failed' }
  | { status: 'failed' };

// ---------- 정규화·검증 ----------

const len = (s: string) => [...s].length;

export const normalizeName = (s: string) => s.trim().replace(/\s{2,}/g, ' ');
export const normalizePhone = (s: string): string | null => {
  const t = s.trim();
  return t === '' ? null : t;
};

const CONTROL = /\p{Cc}/u;
const PHONE_CHARS = /^[0-9\s\-+()]+$/;
const digitCount = (s: string) => (s.match(/\d/g) ?? []).length;
// 서버(api/src/ops/admin-profile.ts memo_has_pii)와 같은 규칙. 날짜(2026-11-26)는 허용한다.
const MEMO_PHONE_LIKE = /(?<!\d)0\d{1,2}[\s.\-]\d{3,4}[\s.\-]\d{4}(?!\d)|\d{10,}/;
const MEMO_EMAIL = /\S@\S/;
const MEMO_CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;

export const MSG = {
  nameLength: '이름은 2자 이상 100자 이하로 입력해 주세요.',
  nameReserved: '이 이름은 쓸 수 없어요. 다른 이름을 입력해 주세요.',
  phone: '휴대전화는 숫자 7개 이상, 30자 이하로 입력해 주세요. 숫자, 공백, -, +, ( )만 쓸 수 있어요.',
  phoneMasked: '가려진 번호는 저장할 수 없어요. 회원에게 받은 번호 전체를 입력해 주세요.',
  reason: '고치는 이유를 골라 주세요.',
  memoRequired: '기타를 고르면 메모를 5자 이상 적어 주세요.',
  memoLength: '메모는 100자 이하로 적어 주세요.',
  memoPii: '메모에는 이름이나 전화번호를 적지 말아 주세요.',
  verified: '본인 확인을 마친 뒤에 체크해 주세요.',
  none: '바뀐 내용이 없어요.',
} as const;

export type FormState = { name: string; phone: string; reason: EditReason | ''; memo: string; verified: boolean };
export type FormErrors = Partial<Record<FieldKey, string>>;

export function changedFields(form: Pick<FormState, 'name' | 'phone'>, baseline: Values): ('name' | 'phone')[] {
  const out: ('name' | 'phone')[] = [];
  if (normalizeName(form.name) !== baseline.name) out.push('name');
  if (normalizePhone(form.phone) !== baseline.phone) out.push('phone');
  return out;
}

export function validateName(raw: string): string | undefined {
  const t = raw.trim();
  if (CONTROL.test(t)) return MSG.nameLength;
  const n = normalizeName(t);
  if (len(n) < LIMITS.nameMin || len(n) > LIMITS.nameMax) return MSG.nameLength;
  if (n === '탈퇴한 회원') return MSG.nameReserved;
  return undefined;
}

export function validatePhone(raw: string): string | undefined {
  const t = raw.trim();
  if (t === '') return undefined;
  if (t.includes('*')) return MSG.phoneMasked;
  if (!PHONE_CHARS.test(t) || len(t) < LIMITS.phoneMin || len(t) > LIMITS.phoneMax || digitCount(t) < 7) return MSG.phone;
  return undefined;
}

export function validateMemo(memo: string, reason: EditReason | ''): string | undefined {
  const t = memo.trim();
  if (reason === 'other' && len(t) < LIMITS.memoMin) return MSG.memoRequired;
  if (len(t) > LIMITS.memoMax) return MSG.memoLength;
  if (t && (MEMO_CONTROL.test(t) || MEMO_PHONE_LIKE.test(t) || MEMO_EMAIL.test(t))) return MSG.memoPii;
  return undefined;
}

// 바꾼 게 없으면 오류도 보이지 않는다(바꿀 게 없는데 오류만 늘리지 않기). 기존 값이 규칙을 못 지켜도 안 바꾼 칸은 검증하지 않는다.
export function validateForm(form: FormState, baseline: Values): { hasChange: boolean; errors: FormErrors } {
  const changed = changedFields(form, baseline);
  if (changed.length === 0) return { hasChange: false, errors: {} };
  const errors: FormErrors = {};
  if (changed.includes('name')) {
    const e = validateName(form.name);
    if (e) errors.name = e;
  }
  if (changed.includes('phone')) {
    const e = validatePhone(form.phone);
    if (e) errors.phone = e;
  }
  if (form.reason === '') errors.reason = MSG.reason;
  const memoErr = validateMemo(form.memo, form.reason);
  if (memoErr) errors.memo = memoErr;
  if (!form.verified) errors.verified = MSG.verified;
  return { hasChange: true, errors };
}

export const FIELD_ORDER: readonly FieldKey[] = ['name', 'phone', 'reason', 'memo', 'verified'];
export const firstErrorField = (errors: FormErrors): FieldKey | null => FIELD_ORDER.find((k) => errors[k]) ?? null;

// 서버가 돌려준 validation 코드를 칸 문구로
export function messageForServerValidation(field: FieldKey | 'none', code?: string): string {
  switch (code) {
    case 'name_reserved':
      return MSG.nameReserved;
    case 'phone_masked':
      return MSG.phoneMasked;
    case 'memo_required':
      return MSG.memoRequired;
    case 'memo_length':
      return MSG.memoLength;
    case 'memo_has_pii':
      return MSG.memoPii;
    case 'reason_required':
      return MSG.reason;
    case 'not_checked':
      return MSG.verified;
    default:
      break;
  }
  switch (field) {
    case 'name':
      return MSG.nameLength;
    case 'phone':
      return MSG.phone;
    case 'reason':
      return MSG.reason;
    case 'memo':
      return MSG.memoLength;
    case 'verified':
      return MSG.verified;
    default:
      return MSG.none;
  }
}

// ---------- 수정 불가 사유(디자인 스펙 D3 우선순위) ----------

export type MemberEditTarget = { status: 'active' | 'withdrawn' | string; role: string; emailConfirmed: boolean | null; email: string | null };

export function lockedWhy(t: MemberEditTarget): LockedWhy | null {
  if (t.status === 'withdrawn') return 'withdrawn';
  if (t.role === 'admin') return 'target_is_admin';
  if (t.emailConfirmed === false) return 'not_confirmed';
  if (t.emailConfirmed === null) return 'unknown_confirm';
  if (!t.email) return 'no_email';
  return null;
}

export const LOCKED_TEXT: Record<LockedWhy, string> = {
  withdrawn: '탈퇴한 회원이라 고칠 수 없어요. 개인정보가 이미 지워졌어요.',
  target_is_admin: '운영자 계정은 이 화면에서 고칠 수 없어요. 필요하면 개발 담당에게 요청해 주세요.',
  not_confirmed: '아직 가입을 마무리하지 않은 회원이에요. 가입을 마친 뒤에 고칠 수 있어요.',
  unknown_confirm: '가입 상태를 확인하지 못했어요. 잠시 후 화면을 다시 열어 주세요.',
  no_email: '가입 이메일이 없어 본인 확인을 할 수 없어요. 개발 담당에게 알려 주세요.',
};

// ---------- 결과 문구 ----------

export function savedMessage(changed: ('name' | 'phone')[], mailQueued: boolean): string {
  const what = changed.length === 1 ? (changed[0] === 'name' ? '이름을' : '휴대전화를') : '이름·연락처를';
  return mailQueued ? `${what} 수정했어요. 가입 이메일로 안내 메일을 보냈어요.` : `${what} 수정했어요.`;
}
export const MAIL_UNSURE = '수정은 끝났어요. 다만 안내 메일을 보내지 못했을 수 있어요. 회원에게 전화로 한 번 알려 주세요.';
export const UNCHANGED_SERVER = '바뀐 내용이 없어요. 저장하지 않았어요.';
export const FAIL_TEXT = '처리 중 문제가 발생했어요. 입력한 내용은 그대로예요. 잠시 후 다시 시도해 주세요.';
export const LOG_FAILED_TEXT = '접속 기록을 남기지 못해서 저장하지 않았어요. 입력한 내용은 그대로예요. 잠시 후 다시 눌러 주세요.';
export const FORBIDDEN_TEXT = '관리자 권한이 필요해요. 권한이 있는 계정으로 로그인해 주세요.';
export const STATE_CHANGED_TEXT = '그 사이 회원 상태가 바뀌어 저장하지 못했어요. 화면을 새로 열었어요. 아래 안내를 확인해 주세요.';

// ---------- 편집기 상태 전이 ----------

export type Step = 'view' | 'edit' | 'confirm';
export type Notice =
  | { kind: 'stale'; mine: { name: string; phone: string }; changedFields: ('name' | 'phone')[] }
  | { kind: 'failed' | 'log_failed' | 'forbidden' | 'locked' }
  | null;
export type Banner = { kind: 'saved'; changed: ('name' | 'phone')[]; mailQueued: boolean } | { kind: 'unchanged' } | null;
export type FocusTarget = FieldKey | 'notice' | 'banner' | 'confirmHeading' | 'editButton';

export type EditorState = {
  step: Step;
  baseline: Values;
  form: FormState;
  errors: FormErrors;
  notice: Notice;
  banner: Banner;
  locked: LockedWhy | null; // 저장 중 서버가 알려 준 수정 불가 상태
  focus: FocusTarget | null;
};

export const formFrom = (v: Values): FormState => ({ name: v.name, phone: v.phone ?? '', reason: '', memo: '', verified: false });

export function initialState(baseline: Values): EditorState {
  return { step: 'view', baseline, form: formFrom(baseline), errors: {}, notice: null, banner: null, locked: null, focus: null };
}

export function startEdit(s: EditorState): EditorState {
  return { ...s, step: 'edit', form: formFrom(s.baseline), errors: {}, notice: null, banner: null, focus: 'name' };
}

export function cancelEdit(s: EditorState): EditorState {
  return { ...s, step: 'view', form: formFrom(s.baseline), errors: {}, notice: null, focus: 'editButton' };
}

export function isDirty(s: EditorState): boolean {
  const f = s.form;
  return changedFields(f, s.baseline).length > 0 || f.reason !== '' || f.memo.trim() !== '' || f.verified;
}

export function applyOutcome(s: EditorState, o: SaveOutcome): EditorState {
  switch (o.status) {
    case 'ok':
      return { ...s, step: 'view', baseline: o.profile, form: formFrom(o.profile), errors: {}, notice: null, banner: { kind: 'saved', changed: o.changed, mailQueued: o.mailQueued }, focus: 'banner' };
    case 'unchanged':
      return { ...s, step: 'view', baseline: o.profile, form: formFrom(o.profile), errors: {}, notice: null, banner: { kind: 'unchanged' }, focus: 'banner' };
    case 'stale': {
      // 현재 값으로 다시 채운다. 이유·메모는 유지하고, 값이 달라졌으니 본인 확인 체크는 해제한다.
      const mine = { name: s.form.name, phone: s.form.phone };
      const changed: ('name' | 'phone')[] = [];
      if (o.current.name !== s.baseline.name) changed.push('name');
      if (o.current.phone !== s.baseline.phone) changed.push('phone');
      return {
        ...s,
        step: 'edit',
        baseline: o.current,
        form: { ...s.form, name: o.current.name, phone: o.current.phone ?? '', verified: false },
        errors: {},
        notice: { kind: 'stale', mine, changedFields: changed },
        focus: 'notice',
      };
    }
    case 'validation': {
      const key: FieldKey = o.field === 'none' ? 'name' : o.field;
      return { ...s, step: 'edit', errors: { [key]: messageForServerValidation(o.field, o.code) }, notice: null, focus: key };
    }
    case 'locked':
      return { ...s, step: 'view', form: formFrom(s.baseline), errors: {}, notice: { kind: 'locked' }, locked: o.why, focus: 'notice' };
    case 'forbidden':
      return { ...s, step: 'view', form: formFrom(s.baseline), errors: {}, notice: { kind: 'forbidden' }, focus: 'notice' };
    case 'log_failed':
      return { ...s, notice: { kind: 'log_failed' }, focus: 'notice' };
    case 'not_found':
    case 'failed':
      return { ...s, notice: { kind: 'failed' }, focus: 'notice' };
  }
}

// ---------- 이력 표시 ----------

const KST = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export function formatKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const p = Object.fromEntries(KST.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}.${p.month}.${p.day} ${hour}:${p.minute}`;
}

export function historyFieldsLabel(fields: string[]): string {
  const n = fields.includes('name');
  const p = fields.includes('phone');
  return n && p ? '이름, 휴대전화' : n ? '이름' : p ? '휴대전화' : '-';
}

export function historyReasonLabel(reason: string | null): string {
  return reason && (REASONS as readonly string[]).includes(reason) ? REASON_LABEL[reason as EditReason] : '-';
}
