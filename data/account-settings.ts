// 마이페이지 "계정" 설정 관련 고정 값. app/actions/account.ts(서버 검증)와
// components/mypage/*(선택지 렌더링) 양쪽이 같은 값을 참조해야 어긋나지 않는다.

// 회원탈퇴 사유(대표 요청, 2026-09-16 — 사유 선택 없이 바로 탈퇴되지 않아야 함).
// 값 자체는 DB에 enum이 아니라 text로 저장되므로(schema.sql 참고) 목록을 자유롭게
// 늘리거나 문구를 바꿀 수 있다 — key만 유지하면 기존 통계와 어긋나지 않는다.
export const WITHDRAWAL_REASONS: { key: string; label: string }[] = [
  { key: 'no_longer_needed', label: '더 이상 서비스를 이용하지 않아요' },
  { key: 'no_desired_course', label: '원하는 강좌/과정이 없어요' },
  { key: 'inconvenient', label: '이용 방법이 불편해요' },
  { key: 'privacy_concern', label: '개인정보 제공이 부담스러워요' },
  { key: 'other', label: '기타' },
];
