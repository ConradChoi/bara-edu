import 'server-only';
import { encode } from 'uqr';

// 인증 앱 등록용 QR(기획서 2.4·4.4.2, 4.11 D-19). API는 QR을 만들지 않고 otpauthUri만 준다.
// 앱 서버(서버 액션·서버 컴포넌트)에서만 그린다 — 비밀 키가 담긴 주소를 외부 QR 서비스로 보내지 않고,
// 라이브러리(uqr, 의존성 없음)도 브라우저 번들에 들어가지 않는다. 결과는 흑백 모듈의 SVG path 한 줄이다.
// 이 값(주소·path)은 로그·오류 추적에 넘기지 않는다.

export type QrSvg = { size: number; path: string };

// 조용한 영역(quiet zone)은 화면의 흰 여백(p-4)이 맡으므로 border 0. 오류 정정 M(약 15%)은 화면 촬영에 충분하고
// 버전(격자 크기)이 작아 208px 안에서 모듈이 커진다.
export function qrSvg(text: string): QrSvg {
  const qr = encode(text, { ecc: 'M', border: 0 });
  let path = '';
  for (let y = 0; y < qr.size; y++) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.data[y][x]) {
        x++;
        continue;
      }
      // 같은 줄의 이어진 검은 칸은 사각형 하나로 묶는다(path 길이 줄이기)
      let run = 1;
      while (x + run < qr.size && qr.data[y][x + run]) run++;
      path += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return { size: qr.size, path };
}
