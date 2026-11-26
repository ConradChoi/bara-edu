// 2단계 화면이 hidden 필드·링크로 넘기는 ?redirect= 값. 최종 검사는 서버 액션의 safeRedirect가 한다(오픈 리다이렉트 방지).
// 여기서는 모양이 명백히 틀린 값만 버려 화면에 다시 싣지 않는다.
export function carryRedirect(v: string | string[] | undefined): string | null {
  if (typeof v !== 'string' || v.length > 2048) return null;
  if (!v.startsWith('/') || v.startsWith('//') || /[\u0000-\u001f\u007f-\u009f\s\\]/.test(v)) return null;
  return v;
}
