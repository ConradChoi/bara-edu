import 'server-only';
import { headers } from 'next/headers';

// 인증·재설정 메일 링크의 도메인 — 요청이 실제로 들어온 호스트 기준(로컬/운영 모두 맞게).
// API가 허용 목록(siteOrigins)에 없는 origin은 거부한다.
export async function getSiteOrigin(): Promise<string> {
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host') ?? 'localhost:3000';
  const proto = headersList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
