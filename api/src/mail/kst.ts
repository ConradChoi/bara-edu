// 알림 메일의 {at}(바뀐 시각) 표시용 KST 시각: 2026년 11월 26일 오후 2시 12분
// profile_changed·password_changed 두 메일이 같은 형식을 쓴다(카피 문서 password-reset-request-copy.md 5.1).
export function kstStamp(d: Date): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: 'numeric', hour12: false }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const h = g('hour') % 24;
  return `${g('year')}년 ${g('month')}월 ${g('day')}일 ${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시 ${g('minute')}분`;
}
