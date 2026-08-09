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
