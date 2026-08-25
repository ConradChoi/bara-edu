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
