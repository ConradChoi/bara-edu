import { createHmac, timingSafeEqual } from 'node:crypto';
import { getPiiRevealSecret } from '@/lib/db/service-key';

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
// HMAC 키는 다른 용도와 섞지 않는 전용 시크릿이다(보안 점검 잔여 권고 — 이전에는
// 서버 마스터 키를 재사용했다). 운영은 SSM, 로컬은 BARA_PII_REVEAL_SECRET.
// 키를 못 읽으면 throw하고, 호출부가 기존처럼 실패 배너·마스킹 유지로 처리한다.
const REVEAL_TTL_MS = 5 * 60 * 1000;

async function sign(scope: string, id: string, adminId: string, exp: number): Promise<string> {
  return createHmac('sha256', await getPiiRevealSecret()).update(`${scope}:${id}:${adminId}:${exp}`).digest('hex');
}

export async function createRevealToken(scope: string, id: string, adminId: string): Promise<{ token: string; exp: number }> {
  const exp = Date.now() + REVEAL_TTL_MS;
  return { token: await sign(scope, id, adminId, exp), exp };
}

export async function verifyRevealToken(
  scope: string,
  id: string,
  adminId: string,
  token: string | undefined | null,
  exp: number | undefined | null
): Promise<boolean> {
  if (!token || !exp) return false;
  if (Date.now() > exp) return false;

  const expected = Buffer.from(await sign(scope, id, adminId, exp), 'hex');
  const actual = Buffer.from(token, 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
