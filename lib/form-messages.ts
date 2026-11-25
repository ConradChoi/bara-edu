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
