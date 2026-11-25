// 재시도 실패 횟수를 sessionStorage에 센다(정의서 3.5). 키는 경로별. 막힌 환경(사생활 보호 모드 등)은 0으로 본다.
// 오류 화면은 "정상 렌더링에 성공했는지"를 알 수 없어 지우는 시점이 없다 — 대신 5분이 지나면 처음부터 다시 센다.
const TTL_MS = 5 * 60 * 1000;

type Entry = { n: number; at: number };

function read(key: string): Entry | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const e = JSON.parse(raw) as Partial<Entry>;
    if (typeof e.n !== 'number' || typeof e.at !== 'number' || Date.now() - e.at > TTL_MS) return null;
    return { n: e.n, at: e.at };
  } catch {
    return null;
  }
}

export const retryKey = (pathname: string) => `bara:error-retries:${pathname}`;

export function readCount(key: string): number {
  return read(key)?.n ?? 0;
}

export function bumpCount(key: string): number {
  const n = readCount(key) + 1;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ n, at: Date.now() } satisfies Entry));
  } catch {
    // 저장이 막힌 환경: 항상 처음 상태로 보인다
  }
  return n;
}

// 이 횟수부터 "같은 문제가 반복돼요" 화면으로 바꾼다.
export const REPEATED_AT = 2;
