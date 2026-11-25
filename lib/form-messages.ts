// 폼/액션이 화면에 보여 주는 공통 오류 문구. 쉬운 존댓말 '~해요'체, "해 주세요" 띄어쓰기.
// API 상태에 따라 문구를 나눈다: 429(요청이 많음), 503(연결 불가), 그 밖의 실패.

export const MSG_RATE_LIMITED = '요청이 많아요. 잠시 후 다시 시도해 주세요';
export const MSG_UNAVAILABLE = '지금 연결이 원활하지 않아요. 잠시 후 다시 눌러 주세요';

// API(zod)의 입력 한도. 앱이 먼저 같은 한도로 검사해 어느 칸이 문제인지 알려 준다.
// 한도를 바꾸면 api/src/auth/routes.ts의 스키마와 함께 바꾼다.
export const LIMITS = { email: 254, password: 200, name: 100, phone: 30 } as const;

// zod 3.25 .email()과 같은 규칙(영문·숫자와 _ ' + - . 만, 연속 점·앞 점 금지, 도메인 끝은 영문 2자 이상).
// 앱의 단순 검사(a@b.c)를 통과해도 API가 400을 내는 주소(한글 주소, 특수문자 등)를 미리 거른다.
const API_EMAIL_RE = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;

export function isApiEmail(email: string): boolean {
  return email.length <= LIMITS.email && API_EMAIL_RE.test(email);
}

// API 400 응답의 error.field → 칸별 문구. 모르는 칸(origin 등 사용자가 고칠 수 없는 값)은 undefined.
export type FormField = 'email' | 'password' | 'name' | 'phone';
export const FIELD_MESSAGES: Record<FormField, string> = {
  email: '올바른 이메일 형식이 아니에요',
  password: `비밀번호는 8자 이상 ${LIMITS.password}자 이하로 입력해 주세요`,
  name: `이름은 2자 이상 ${LIMITS.name}자 이하로 입력해 주세요`,
  phone: `연락처는 ${LIMITS.phone}자 이하로 입력해 주세요`,
};
export function formField(v: string | undefined): FormField | undefined {
  return v === 'email' || v === 'password' || v === 'name' || v === 'phone' ? v : undefined;
}

// 화면(클라이언트)의 불일치 안내 문구. 서버가 돌려줄 때는 칸이 비워져 돌아오므로 "다시"를 넣는다(디자인 스펙 V-1.2).
export const MSG_PASSWORD_MISMATCH_CLIENT = '비밀번호가 서로 달라요. 두 칸에 같은 비밀번호를 입력해 주세요.';
export const MSG_PASSWORD_MISMATCH = '비밀번호가 서로 달라요. 두 칸에 같은 비밀번호를 다시 입력해 주세요.';
