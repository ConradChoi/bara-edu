// 법정 문서(처리방침·이용약관·환불정책) 버전 표시. DB의 version은 정수 그대로 두고 화면에서만 v{n}.0으로 보인다.
// 정식 오픈(2026-11-27)에 처리방침을 버전 1로 새로 시작했다(정식 오픈 계획 docs/01-plan/features/bara-edu-lms.launch-v1.md D2).
export function formatDocVersion(version: number): string {
  return `v${version}.0`;
}

// 오픈 전 처리방침은 보관 테이블(archive)로 옮겼고, 오픈 전 자가진단 동의 기록은 모두 v10을 가리킨다(개인정보 점검: 번호를 바꾸지 않는다).
// 새 체계의 v10과 헷갈리지 않게, 버전 10이면서 이 시각 전에 동의한 기록은 "오픈 전 v10"으로 보인다.
const PRELAUNCH_CONSENT_VERSION = 10;
const PRELAUNCH_BEFORE = Date.parse('2026-11-28T00:00:00+09:00');

export function formatConsentPrivacyDoc(version: number, consentedAt: string | null): string {
  const t = consentedAt ? Date.parse(consentedAt) : NaN;
  if (version === PRELAUNCH_CONSENT_VERSION && !Number.isNaN(t) && t < PRELAUNCH_BEFORE) return `오픈 전 v${version}`;
  return formatDocVersion(version);
}
