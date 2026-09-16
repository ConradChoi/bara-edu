// 자격증 발급용 사진 업로드 검증 헬퍼. File.type(브라우저 자기신고 값)이 아니라 실제
// 바이트 시그니처로 JPEG/PNG/GIF/WebP만 허용한다. image/svg+xml처럼 스크립트를 담을 수
// 있는 포맷이 MIME 문자열 검사만으로 통과되는 걸 막는다(security-officer 점검, 2026-08-28).
// app/actions/enrollment.ts(수강신청)와 app/actions/account.ts(마이페이지 정보 수정) 양쪽이
// 동일한 검증을 쓰므로 별도 모듈로 뺐다 — 둘 다 'use server' 파일이라(async 함수만 export
// 가능) 이 헬퍼는 'use server'가 아닌 일반 모듈에 둬야 한다.
export function detectImageMimeType(header: Uint8Array): string | null {
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg';
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) return 'image/png';
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) return 'image/gif';
  if (
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}
