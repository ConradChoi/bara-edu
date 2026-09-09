// <input type="datetime-local"> 값에는 타임존 정보가 없다. 서버가 UTC로 배포되면
// 관리자가 입력한 시각이 9시간 밀려 저장/비교되는 문제가 생기므로, 이 값은 항상
// 한국 표준시(KST, +09:00)로 고정 해석한다(module-lms-5, 과제 마감기한).

// "YYYY-MM-DDTHH:mm" (datetime-local raw value) → UTC 기준 ISO 문자열
export function parseKstDatetimeLocal(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const parsed = new Date(`${trimmed}:00+09:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// UTC 기준 ISO 문자열 → <input type="datetime-local"> defaultValue용 KST 벽시계 문자열
export function formatKstDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const utc = new Date(iso);
  if (Number.isNaN(utc.getTime())) return '';
  const kst = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 16);
}

// UTC 기준 ISO 문자열 → 학습자 화면에 보여줄 사람이 읽는 KST 문자열(예: "2026. 9. 1. 오후 2:00").
// toLocaleString()에 timeZone을 명시하지 않으면 배포 서버의 타임존을 따라가 버려
// (서버가 UTC로 뜨면 9시간 밀려 보임) — 온라인 수업 일시 표시에 이 문제가 생기지 않도록
// 항상 Asia/Seoul로 고정한다(온라인 수업 일시 표시, 2026-08-25).
export function formatKstDisplay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' });
}

// courses.start_date 같은 순수 날짜("YYYY-MM-DD", 시간 없음) 표시용. new Date(str)로
// 파싱하면 UTC 자정으로 해석되어 toLocaleDateString()이 서버 타임존에 따라 하루
// 밀려 보일 수 있다 — Date 객체를 아예 거치지 않고 문자열만 잘라 조립한다
// (강좌 시작일 노출, 2026-08-28).
export function formatDateOnlyDisplay(dateStr: string | null | undefined): string | null {
  const match = dateStr?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
}

// 시작일/종료일(둘 다 courses.start_date/end_date 형식)을 하나의 문구로 합친다 — 강좌
// 목록·상세에서 둘 다 있으면 "N월 N일 ~ N월 N일", 시작일만 있으면 "N월 N일 개강"으로
// 보여준다(종료일만 있는 경우는 실사용상 드물어 시작일과 동일하게 개강일처럼 표기한다).
export function formatDateRangeDisplay(startDateStr: string | null | undefined, endDateStr: string | null | undefined): string | null {
  const start = formatDateOnlyDisplay(startDateStr);
  const end = formatDateOnlyDisplay(endDateStr);
  if (start && end) return `${start} ~ ${end}`;
  if (start) return `${start} 개강`;
  if (end) return `${end} 개강`;
  return null;
}

// 오늘(KST) 자정을 UTC 기준 ISO 문자열로 반환. 서버(Amplify SSR)는 UTC로 뜨므로
// `new Date().setHours(0,0,0,0)`을 그대로 쓰면 "오늘"이 KST 09:00에 시작하는 버그가
// 생긴다(대시보드 신규가입/신청 집계, 2026-09-09 발견).
export function getKstStartOfTodayIso(): string {
  const now = new Date();
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 9 * 60 * 60 * 1000).toISOString();
}

// 이번 주 월요일 00:00(KST)을 UTC 기준 ISO 문자열로 반환(대시보드 "이번주 신규가입" 집계).
export function getKstStartOfWeekIso(): string {
  const now = new Date();
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const kstDay = shifted.getUTCDay(); // 0=일 ~ 6=토 (KST 기준 요일)
  const diffToMonday = (kstDay + 6) % 7;
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCDate(shifted.getUTCDate() - diffToMonday);
  return new Date(shifted.getTime() - 9 * 60 * 60 * 1000).toISOString();
}

// daysAgo일 전 KST 자정을 UTC 기준 ISO 문자열로 반환(0이면 오늘 KST 자정). 가입 추이
// 차트의 일별 구간 경계를 만드는 데 사용.
export function getKstStartOfDaysAgoIso(daysAgo: number): string {
  const todayStartMs = new Date(getKstStartOfTodayIso()).getTime();
  return new Date(todayStartMs - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

// UTC 기준 ISO 문자열 → KST 기준 "YYYY-MM-DD" 키. 가입 추이처럼 날짜별로 집계할 때 사용.
export function toKstDateKey(iso: string): string {
  const utc = new Date(iso);
  const kst = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// UTC 기준 ISO 문자열 → KST 기준 "M/D" 표기(대시보드 "이번주" 카드의 기간 병기용).
function toKstMonthDay(iso: string): string {
  const utc = new Date(iso);
  const kst = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`;
}

// 이번 주 시작 ISO(getKstStartOfWeekIso 반환값)를 받아 "주 시작~오늘" 형태의 기간 라벨을
// 만든다("9/8~9/14"처럼 주 전체 범위가 아니라, 주 중간에 보면 "9/8~9/9"처럼 아직 끝나지
// 않은 기간으로 표시된다 — "이번주 실적"이 롤링 7일이 아닌 것과 같은 이유, qa-reviewer
// 지적, 2026-09-09).
export function formatKstWeekRangeLabel(weekStartIso: string): string {
  return `${toKstMonthDay(weekStartIso)}~${toKstMonthDay(new Date().toISOString())}`;
}
