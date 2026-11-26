// 자가진단 임시 저장(브라우저 localStorage) 규칙. 화면(DiagnosisStepper)과 테스트가 같이 쓴다.
// 근거: docs/02-design/features/bara-edu-lms.diagnosis-sensitive-consent.md 4.2절.
//  - 키를 v2로 바꾸고, 옛 키(v1, 별도 동의 전에 만든 초안)는 읽지 않고 지운다.
//  - 동의 칸(①·②·버전·③)은 저장하지 않고, 저장돼 있더라도 복원하지 않는다. 동의는 항상 미체크로 시작한다.
//  - 이어서 하면 항상 1페이지(기본정보·동의)부터 시작한다. 동의 없이 문항 페이지에 들어갈 수 없게 한다.

export const DRAFT_KEY = 'bara_selfcheck_draft_v2';
export const LEGACY_DRAFT_KEYS: readonly string[] = ['bara_selfcheck_draft_v1'];
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export const CONSENT_FIELDS: ReadonlySet<string> = new Set(['consentPrivacy', 'consentSensitive', 'consentSensitiveVersion', 'ageConfirmed']);

export type DraftShape = {
  version: string;
  savedAt: number;
  fields: Record<string, string>;
};

// 폼 값 → 저장할 칸. 동의 칸과 파일 값은 뺀다.
export function draftFieldsFrom(entries: Iterable<[string, FormDataEntryValue]>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (CONSENT_FIELDS.has(key) || typeof value !== 'string') continue;
    fields[key] = value;
  }
  return fields;
}

export function buildDraft(entries: Iterable<[string, FormDataEntryValue]>, version: string, now: number): DraftShape {
  return { version, savedAt: now, fields: draftFieldsFrom(entries) };
}

// 저장된 문자열 → 복원할 초안. 형식이 틀렸거나, 문항 버전이 다르거나, 24시간이 지났으면 null.
// 복원 값에서도 동의 칸은 지운다(이전 코드나 조작으로 들어간 값이 체크박스를 켜지 못하게).
export function parseDraft(raw: string | null, version: string, now: number): DraftShape | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const d = parsed as Partial<DraftShape>;
  if (d.version !== version || typeof d.savedAt !== 'number' || now - d.savedAt >= DRAFT_TTL_MS) return null;
  if (typeof d.fields !== 'object' || d.fields === null) return null;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.fields)) {
    if (!CONSENT_FIELDS.has(k) && typeof v === 'string') fields[k] = v;
  }
  return { version, savedAt: d.savedAt, fields };
}

// 클라이언트에서 부른 서버 액션이 redirect()하면 Next는 액션 promise를 NEXT_REDIRECT 오류로 reject한다
// (digest "NEXT_REDIRECT;<push|replace>;<url>;<status>;"). 그래서 await 뒤의 초안 삭제는 실행되지 않는다.
// 결과 화면으로 가는 redirect(제출 성공)인지 이 함수로 판별해 그때만 초안을 지운다(실패 redirect면 초안을 남겨 답을 되살린다).
export function isSubmitSuccessRedirect(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('digest' in err)) return false;
  const digest = String((err as { digest?: unknown }).digest);
  if (!digest.startsWith('NEXT_REDIRECT;')) return false;
  const url = digest.split(';').slice(2, -2).join(';');
  return /^\/selfcheck\/result\/[^/?#]+$/.test(url);
}

// 복원할 때 들어갈 페이지. 동의는 복원하지 않으므로 항상 1페이지(인덱스 0).
export const RESTORE_PAGE = 0;
