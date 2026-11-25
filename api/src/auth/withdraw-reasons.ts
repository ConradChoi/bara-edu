// 탈퇴 사유 고정 목록. 앱 data/account-settings.ts의 WITHDRAWAL_REASONS(key)와 같아야 한다
// (루트 test/lib/withdrawal-reasons-sync.test.ts가 일치를 확인한다). 값만 저장하므로 문구는 앱에 있다.
export const WITHDRAWAL_REASON_KEYS = ['no_longer_needed', 'no_desired_course', 'inconvenient', 'privacy_concern', 'other'] as const;
