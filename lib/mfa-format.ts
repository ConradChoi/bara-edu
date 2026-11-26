// 2단계 인증 화면의 값 다듬기(서버·클라이언트 공용, 비밀 값을 남기지 않는 순수 함수).
// 시각은 모두 서울 기준으로 쓴다(서버는 UTC로 뜬다, lib/kst.ts와 같은 이유).

import type { MfaStatus } from '@/lib/db/mfa';

const KST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function kstParts(iso: string): { y: number; m: number; d: number; h: number; min: number; dayKey: number } | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const k = new Date(t + KST_MS);
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate(), h: k.getUTCHours(), min: k.getUTCMinutes(), dayKey: Math.floor((t + KST_MS) / DAY_MS) };
}

// "2026년 12월 1일"
export function kstLongDate(iso: string | null | undefined): string {
  const p = iso ? kstParts(iso) : null;
  return p ? `${p.y}년 ${p.m}월 ${p.d}일` : '-';
}

// "12월 3일"
export function kstMonthDay(iso: string | null | undefined): string {
  const p = iso ? kstParts(iso) : null;
  return p ? `${p.m}월 ${p.d}일` : '-';
}

// "오후 2시 12분" / 정각이면 "오후 2시"
function kstClock(h: number, min: number): string {
  const half = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${half} ${h12}시${min ? ` ${min}분` : ''}`;
}

// "오늘 오후 2시 12분", "어제 …", "내일 …", 그 밖에는 "11월 26일 오후 2시 12분"(해가 다르면 연도까지)
export function kstWhen(iso: string | null | undefined, now: number = Date.now()): string {
  const p = iso ? kstParts(iso) : null;
  if (!p) return '-';
  const today = Math.floor((now + KST_MS) / DAY_MS);
  const clock = kstClock(p.h, p.min);
  if (p.dayKey === today) return `오늘 ${clock}`;
  if (p.dayKey === today - 1) return `어제 ${clock}`;
  if (p.dayKey === today + 1) return `내일 ${clock}`;
  const thisYear = new Date(now + KST_MS).getUTCFullYear();
  return `${p.y === thisYear ? '' : `${p.y}년 `}${p.m}월 ${p.d}일 ${clock}`;
}

// 유예 배너의 N(기획서 1.3 D8): ⌈(graceUntil − 지금) / 24시간⌉. 형식이 틀리면 null.
export function graceDaysLeft(graceUntil: string | null, now: number = Date.now()): number | null {
  if (!graceUntil) return null;
  const t = new Date(graceUntil).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now) / DAY_MS);
}

// 관리자 화면 상단 배너(M6). 기획서 3.7 표의 위에서부터 첫 번째로 맞는 것 하나만.
export type MfaBanner =
  | { kind: 'mode_off' }
  | { kind: 'recovery_zero' }
  | { kind: 'recovery_used'; left: number }
  | { kind: 'grace'; days: number | null; date: string | null }
  | { kind: 'rc_not_saved' }
  | { kind: 'rc_low'; left: number }
  | { kind: 'mode_optional'; date: string | null };

export function pickMfaBanner(s: MfaStatus, now: number = Date.now()): MfaBanner | null {
  if (s.mode === 'off') return { kind: 'mode_off' };
  if (s.signedInWithRecovery && s.recoveryCodesLeft <= 0) return { kind: 'recovery_zero' };
  if (s.signedInWithRecovery) return { kind: 'recovery_used', left: s.recoveryCodesLeft };
  if (s.mode === 'optional' && !s.enrolled && s.canSelfEnroll) {
    return { kind: 'grace', days: graceDaysLeft(s.graceUntil, now), date: s.graceUntil ? kstMonthDay(s.graceUntil) : null };
  }
  if (s.enrolled && !s.recoveryCodesAcked) return { kind: 'rc_not_saved' };
  if (s.enrolled && s.recoveryCodesLeft >= 1 && s.recoveryCodesLeft <= 3) return { kind: 'rc_low', left: s.recoveryCodesLeft };
  if (s.mode === 'optional' && s.enrolled) return { kind: 'mode_optional', date: s.graceUntil ? kstMonthDay(s.graceUntil) : null };
  return null;
}

// 6자리 번호: 공백·하이픈 등 숫자 외 글자를 지운다(붙여넣은 "123 456" 허용, 기획서 3장 공통 규칙).
export function normalizeOtp(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}
export const isOtp = (v: string) => /^[0-9]{6}$/.test(v);

// 등록 코드: 공백을 지운 숫자 8자리(4.0)
export function normalizeTicket(raw: string): string {
  return raw.replace(/\s/g, '');
}
export const isTicket = (v: string) => /^[0-9]{8}$/.test(v);

// 수동 입력 키(32진 문자)를 4글자씩 나눈다. 묶음 사이 공백은 복사·선택에 넣지 않는다(T-5.3).
export function keyGroups(secret: string): string[] {
  return secret.replace(/\s/g, '').match(/.{1,4}/g) ?? [];
}

// 스크린리더 띄어 읽기(T-8): "ABCDE-FGHJK" → "A B C D E, F G H J K", "12345678" → "1 2 3 4, 5 6 7 8"
export function spokenCode(code: string, groupSize?: number): string {
  const groups = code.includes('-') || code.includes(' ') ? code.split(/[-\s]+/).filter(Boolean) : groupSize ? (code.match(new RegExp(`.{1,${groupSize}}`, 'g')) ?? []) : [code];
  return groups.map((g) => [...g].join(' ')).join(', ');
}
