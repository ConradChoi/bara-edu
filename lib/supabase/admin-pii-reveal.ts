import { createHmac, timingSafeEqual } from 'node:crypto';

// 관리자 "개인정보 보기" reveal 토큰. 목록 화면은 마스킹 해제 여부를 revealPii=<id> 같은
// 쿼리파라미터 하나로 판단했는데, 이 id는 마스킹된 상태에서도 같은 페이지 HTML에 이미
// 노출돼 있어(각 행의 상세 링크·hidden input 등) 관리자가 버튼을 누르지 않고 주소창에
// 직접 붙여넣기만 해도 admin_access_logs에 기록 없이 원문이 보이는 문제가 있었다
// (qa-reviewer 치명적 이슈 #1, privacy-security-officer M-1 공통 지적, 2026-09-14).
//
// 해결: reveal 서버 액션에서만 발급 가능한, 관리자 id·대상 id·만료시각을 서명한 단기(5분)
// 토큰을 함께 요구한다. 목록 조회 함수는 이 서명을 검증했을 때만 마스킹을 해제하고, 그
// 검증에 성공한 바로 그 순간에만 logAdminAccess()를 호출한다 — "해제됨"과 "기록됨"이
// 항상 같은 조건에서 함께 일어나도록 만들어 로그 우회 자체를 구조적으로 막는다.
// 새 시크릿을 추가하지 않고 이미 서버 전용으로만 쓰이는 SUPABASE_SERVICE_ROLE_KEY를
// HMAC 키로 재사용한다(이 프로젝트의 "불필요한 신규 의존성/시크릿 추가 지양" 원칙).
const REVEAL_TTL_MS = 5 * 60 * 1000;

function secret(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return key;
}

function sign(scope: string, id: string, adminId: string, exp: number): string {
  return createHmac('sha256', secret()).update(`${scope}:${id}:${adminId}:${exp}`).digest('hex');
}

export function createRevealToken(scope: string, id: string, adminId: string): { token: string; exp: number } {
  const exp = Date.now() + REVEAL_TTL_MS;
  return { token: sign(scope, id, adminId, exp), exp };
}

export function verifyRevealToken(
  scope: string,
  id: string,
  adminId: string,
  token: string | undefined | null,
  exp: number | undefined | null
): boolean {
  if (!token || !exp) return false;
  if (Date.now() > exp) return false;

  const expected = Buffer.from(sign(scope, id, adminId, exp), 'hex');
  const actual = Buffer.from(token, 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
