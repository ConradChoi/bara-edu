// 도형심리 자가진단 민감정보 동의 기능의 화면 문구(버전 고정 대상이 아닌 것).
// 출처: docs/02-design/features/bara-edu-lms.diagnosis-sensitive-consent-copy.md 슬롯 SC-* 원문 그대로.
// 동의 상자 ②(민감정보) 원문은 여기 두지 않는다: 버전별로 고정하는 data/diagnosis/consent.ts(sc-v1)에서 그린다.
// `**…**`는 굵게 표시할 부분(components/diagnosis/BoldText.tsx가 해석한다).
// {phone}·{hours}·{date}는 화면이 siteConfig·값으로 채운다(전화번호·운영시간 하드코딩 금지).

// 1. /selfcheck 랜딩
export const LANDING_NOTE = '응답과 결과는 민감정보로 다루기 때문에, 시작할 때 따로 동의를 받아요.'; // SC-LAND-NOTE

// 2.1 ① 개인정보 수집·이용 동의
export const PRIVACY_CONSENT_COPY = {
  title: '개인정보 수집·이용 동의 (필수)', // SC-PRIV-TITLE
  items: [
    '**항목**: 이름, 휴대전화 또는 이메일(1개 이상), 도형심리 학습 경험, 보유 자격 수준(적은 경우)', // SC-PRIV-ITEMS
    '**목적**: 자가진단 결과를 본인에게 연결하고, 추천 과정을 안내하고, 강사과정 상담 때 연락하기 위해 써요.', // SC-PRIV-PURPOSE
    '**보유 기간**: 회원 계정에 연결하지 않으면 진단한 날부터 90일이 지나면 지워요. 회원 계정에 연결하면 회원 탈퇴 때까지 보관해요.', // SC-PRIV-PERIOD
    '**동의하지 않을 수 있어요.** 다만 동의하지 않으면 자가진단을 할 수 없어요.', // SC-PRIV-REFUSE
  ],
  check: '개인정보 수집·이용에 동의해요 (필수)', // SC-PRIV-CHECK
  link: '전체 내용 보기', // SC-PRIV-LINK
  linkSr: '개인정보처리방침 전체 내용 보기, 새 창에서 열려요', // SC-PRIV-LINK-SR
  error: '개인정보 수집·이용에 동의해야 자가진단을 시작할 수 있어요', // SC-PRIV-ERR
} as const;

// 2.3 ③ 연령 확인
export const AGE_CONFIRM_COPY = {
  check: '만 14세 이상이에요 (필수)', // SC-AGE-CHECK
  error: '만 14세 미만은 법정대리인 동의가 필요해 온라인으로 접수할 수 없어요', // SC-AGE-ERR
} as const;

// 2.4 ② 미체크 — 거부·차단 상태와 대안
export const SENSITIVE_REFUSAL_COPY = {
  error: '자가진단을 하려면 이 동의가 필요해요.', // SC-SENS-ERR (옵션 A)
  notSent: '아직 회사로 보낸 정보는 없어요.', // SC-REFUSE-NOTSENT
  altTitle: '동의 없이도 이렇게 도움받을 수 있어요', // SC-REFUSE-ALT-TITLE
  courses: '강좌 둘러보기', // SC-REFUSE-COURSES
  phone: '전화로 상담받기 {phone}', // SC-REFUSE-PHONE
  hours: '운영시간 {hours}', // SC-REFUSE-HOURS
} as const;

// 2.5 초안 복원 대화상자
export const DRAFT_RESTORE_COPY = {
  title: '작성하던 진단이 있어요', // SC-DRAFT-TITLE
  body: '이어서 진행할까요?', // SC-DRAFT-BODY
  consent: '동의는 첫 화면에서 다시 해 주세요.', // SC-DRAFT-CONSENT
  shared: '다른 사람이 쓰던 기기라면 [새로 시작하기]를 눌러 주세요.', // SC-DRAFT-SHARED
  startNew: '새로 시작하기', // SC-DRAFT-NEW
  continue: '이어서 하기', // SC-DRAFT-CONTINUE
} as const;

// 3. 제출 오류 (/selfcheck/start?error=)
export const SUBMIT_ERROR_COPY = {
  validation: '필수 항목을 확인해 주세요.', // SC-ERR-VALIDATION
  'consent-required': '자가진단을 하려면 동의가 필요해요. 아래 동의 항목을 확인해 주세요.', // SC-ERR-CONSENT
  incomplete: '아직 응답하지 않은 문항이 있어요.', // SC-ERR-INCOMPLETE
  'submit-failed': '제출에 실패했어요. 잠시 후 다시 시도해 주세요.', // SC-ERR-FAILED
} as const;

// SC-ERR-OUTDATED. 셋째 문장(answersKept)은 브라우저 초안에서 답을 복원할 수 있을 때만 붙인다(문구 문서 3장).
export const OUTDATED_ERROR_COPY = {
  base: '동의 안내가 바뀌었어요. 바뀐 내용을 읽고 다시 동의해 주세요.',
  answersKept: '입력한 답은 그대로예요.',
} as const;

export type SubmitErrorCode = keyof typeof SUBMIT_ERROR_COPY | 'consent-outdated';

export function isSubmitErrorCode(v: string | undefined): v is SubmitErrorCode {
  return v === 'consent-outdated' || (v !== undefined && Object.prototype.hasOwnProperty.call(SUBMIT_ERROR_COPY, v));
}

// 4. /selfcheck/result/[token]
export const RESULT_COPY = {
  linkNotice: '이 화면 주소(결과 링크)를 아는 사람은 누구나 추천 과정과 전체 점수를 볼 수 있어요. 결과 링크는 다른 사람에게 보내지 않도록 조심해 주세요.', // SC-RES-LINK-NOTICE
  claimWarn: '본인이 직접 응답한 결과만 연결해 주세요. 연결하면 회원 탈퇴 때나 직접 지울 때까지 보관돼요.', // SC-RES-CLAIM-WARN
  deleteBtn: '이 진단 기록 지우기', // SC-RES-DEL-BTN
  notFoundTitle: '결과를 찾을 수 없어요', // SC-RES-NOTFOUND-TITLE
  notFoundDesc: '링크가 정확한지 확인해 주세요. 보관 기간이 지났거나 지운 결과는 열리지 않아요.', // SC-RES-NOTFOUND-DESC
  notFoundBtn: '새로 진단받기', // SC-RES-NOTFOUND-BTN
} as const;

// 5. 진단 기록 지우기
export const DELETE_RESULT_COPY = {
  trigger: '지우기', // SC-MY-DEL-BTN
  triggerSr: '{date} 진단 기록 지우기', // SC-MY-DEL-BTN-SR
  title: '이 진단 기록을 지울까요?', // SC-DEL-CONFIRM-TITLE
  body: '응답과 점수가 모두 지워져요. 지운 뒤에는 되돌릴 수 없고, 결과 링크로도 열리지 않아요.', // SC-DEL-CONFIRM-BODY
  withLeads: '강사과정 상담 문의도 함께 지우기', // SC-DEL-CONFIRM-LEAD
  withLeadsHelp: '체크를 풀면 상담 문의는 접수일부터 1년 동안 보관한 뒤 지워요.', // SC-DEL-CONFIRM-LEAD-HELP
  confirm: '지우기', // SC-DEL-CONFIRM-OK
  cancel: '그대로 두기', // SC-DEL-CONFIRM-CANCEL (옵션 A)
  busy: '지우는 중이에요', // SC-DEL-BUSY
  done: '진단 기록을 지웠어요.', // SC-MY-DEL-DONE
  fail: '진단 기록을 지우지 못했어요. 잠시 후 다시 시도해 주세요. 계속 안 되면 전화로 문의해 주세요. 전화 {phone}', // SC-MY-DEL-FAIL
  empty: '아직 자가진단 기록이 없어요', // SC-MY-EMPTY
  emptyBtn: '도형심리 역량진단 받아보기', // SC-MY-EMPTY-BTN
} as const;

// 5.1 회원 탈퇴 안내
export const WITHDRAW_NOTE = '탈퇴 시 개인정보는 즉시 익명화되고 학습 이력과 자가진단 기록은 파기돼요.'; // SC-WD-NOTE

// 6. 관리자
export const ADMIN_DIAGNOSIS_COPY = {
  maskHint: '이름은 가려서 보여 드려요. 원래 이름은 [개인정보 보기]나 상세 화면에서 볼 수 있고, 볼 때마다 접속 기록이 남아요.', // SC-ADM-MASK-HINT
  consentLabel: '동의 기록', // SC-ADM-CONSENT-LABEL
  consentValue: '민감정보 동의 {version} · {datetime} / 처리방침 v{n}', // SC-ADM-CONSENT-VALUE
  consentNoDoc: '처리방침 버전 기록 없음', // SC-ADM-CONSENT-NODOC
  consentNone: '별도 동의 없음(변경 전 결과)', // SC-ADM-CONSENT-NONE
} as const;

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
