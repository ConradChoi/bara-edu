// 가입 마무리 화면의 시각 표시. 서버(page)에서 문자열로 만들어 넘긴다 — 클라이언트에서 현재 시각으로
// 다시 계산하면 서버 렌더와 어긋나 하이드레이션 경고가 난다. 시각은 한국 시간(KST, UTC+9)으로 고정한다.

const KST_MS = 9 * 60 * 60 * 1000;

// 2026-11-25T06:10:00Z -> "11월 25일 오후 3시 10분"
export function formatRequestedAt(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + KST_MS);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const half = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${half} ${h12}시${m ? ` ${m}분` : ''}`;
}

// 남은 시간: 올림한 시간 수. 1시간 미만이면 "1시간 안에 마쳐 주세요"(문구 문서 4.1). 이미 지났으면 null.
export function formatRemaining(expiresIso: string, nowMs: number = Date.now()): string | null {
  const t = Date.parse(expiresIso);
  if (Number.isNaN(t) || t <= nowMs) return null;
  const hours = Math.max(1, Math.ceil((t - nowMs) / (60 * 60 * 1000)));
  return `${hours}시간 안에 마쳐 주세요`;
}
