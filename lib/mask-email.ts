// 관리자 화면(대시보드 최근 가입자)의 이메일 가림. API의 api/src/ops/admin-diagnosis.ts maskEmail과 같은 규칙이다
// (2026-11-27 통일, 개인정보 점검 R-1·R-2·R-5). 두 곳의 결과가 같은지는 공용 표 test/fixtures/mask-email-cases.json으로 앱·API 테스트가 함께 확인한다.
// 공백이 있거나 @가 하나가 아니거나 도메인이 영문 TLD 도메인 모양이 아니면(한글 도메인 포함) 통째로 '***' — 도메인 자리에 이름 등이 들어가도 새지 않게.
// 아이디에 한글 등 영문·숫자·기호 밖의 글자가 있으면 아이디 부분을 '***'로(2026-11-27 후속).
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '-';
  const t = email.trim();
  const at = t.indexOf('@');
  if (at <= 0 || /\s/.test(t) || t.indexOf('@', at + 1) !== -1) return '***';
  const local = t.slice(0, at);
  const domain = t.slice(at + 1);
  if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(domain) || (domain.match(/[0-9]/g)?.length ?? 0) >= 7) return '***';
  // 아이디에 영문·숫자·._%+- 밖의 글자(한글 등)가 있으면 통째로 가린다. 앞 두 글자가 이름 두 글자가 되지 않게.
  if (local.length <= 2 || /[^A-Za-z0-9._%+-]/.test(local)) return `***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}
