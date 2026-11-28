# Pretendard (자체 호스팅)

- 출처: npm `pretendard@1.3.9`의 `dist/web/variable/` (분할판 `pretendardvariable-dynamic-subset.css` + `woff2-dynamic-subset/` 92개 파일). 수정 없이 그대로 복사했다.
- 받은 날: 2026-11-29. 파일 해시가 jsDelivr의 npm·GitHub 배포본과 같음을 확인했다.
- 라이선스: SIL Open Font License 1.1 (`LICENSE.txt`). 글꼴 파일과 함께 둔다.
- 이유: 방문자 IP가 외부 CDN(jsDelivr)으로 전달되지 않게 하고(개인정보 점검 Should, 2026-11-28), 화면에 나온 글자 조각만 받게 해 전송량을 줄인다.
- 불러오는 곳: `app/layout.tsx`에서 CSS를 import한다. 빌드가 글꼴 파일을 `/_next/static/media/`로 내보내 1년 캐시된다(`public/`은 5초 캐시라 쓰지 않는다).
- 버전을 올릴 때: 같은 경로의 파일을 통째로 바꾸고 이 문서의 버전·날짜를 고친다.
