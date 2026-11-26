// 2단계 인증 화면 상태(서버 액션 ↔ 클라이언트 컴포넌트 공용 타입). 문구는 화면이 MFA_COPY로 고른다.
// 서버 액션은 이전 상태(prevState)에 기대지 않는다: JS 없이 제출해도 같은 결과가 나오게 폼 값과 서버 상태만으로 다음 화면을 정한다.

export type LockInfo = { lockScope: 'account' | 'daily'; minutes: number };

// ---- M1·M2 로그인 2단계 ----

// field: 칸 아래 오류(입력값 지움, 형식 오류만 유지) / notice: 폼 위 알림(입력값 유지) / screen: 폼을 상태 화면으로 대체(T-3.3)
export type MfaLoginState =
  | { kind: 'field'; error: 'format' | 'wrong' | 'used'; attemptsLeft?: number }
  | { kind: 'notice'; notice: 'rate_limited' | 'unavailable' | 'failed' }
  | { kind: 'screen'; screen: 'expired' | 'demoted' | 'exhausted' }
  | ({ kind: 'screen'; screen: 'locked' } & LockInfo)
  | undefined;

// ---- M3 등록 단계(입구 A·B·C)와 M4 내 보안 설정 ----

export type QrView = { enrollmentId: string; size: number; path: string; keyGroups: string[]; otpauthUri: string };

export type SetupNotice =
  | { kind: 'rate_limited' | 'unavailable' | 'failed' | 'already' | 'session_expired' | 'not_admin' | 'norc' }
  | ({ kind: 'locked' } & LockInfo);

export type SetupEntry = 'A' | 'B' | 'C';

export type CodesReason = 'enroll' | 'reenroll' | 'change' | 'regen';

export type SetupView =
  | { step: 'status'; notice?: SetupNotice }
  // entry: 입구(A 유예 기간 첫 등록 / B 로그인 중 / C 인증 앱 바꾸기). checkedWith: 입구 C 재확인 수단(복구 코드면 새로 받기 기본 체크)
  | { step: 'prep'; entry: SetupEntry; checkedWith?: 'otp' | 'rc'; notice?: SetupNotice }
  | { step: 'ticket'; error?: 'format' | 'wrong'; attemptsLeft?: number; notice?: SetupNotice }
  // 입구 C(인증 앱 바꾸기)·복구 코드 새로 받기의 재확인(e). mode: 6자리(otp) / 복구 코드(rc, 바꾸기만)
  | { step: 'recheck'; purpose: 'change' | 'regen'; mode: 'otp' | 'rc'; error?: 'format' | 'wrong' | 'used'; notice?: SetupNotice }
  | { step: 'qr'; entry: SetupEntry; qr: QrView; rotateDefault: boolean; error?: 'format' | 'wrong' | 'used'; attemptsLeft?: number; notice?: SetupNotice }
  | { step: 'qr_expired'; entry: SetupEntry; notice?: SetupNotice }
  // 복구 코드 10개(한 번만). issuedOn·name은 인쇄용 안내지(MFA-PRINT-DATE·-WHO), name이 없으면 그 줄을 뺀다
  | { step: 'codes'; codes: string[]; issuedOn: string; name: string | null; reason: CodesReason }
  // 입구 C에서 복구 코드를 새로 받지 않고 끝남
  | { step: 'changed' }
  // 로그인 중(입구 B) 상태 화면: 대기표 만료·계정 변경·등록 코드 사용 불가·복구 코드 단계 새로고침
  | { step: 'end'; screen: 'expired' | 'demoted' | 'ticket_dead' | 'reload' };

// ---- M5 관리자 회원 상세의 2단계 인증 초기화(기획서 3.6, 4.6.1, 디자인 스펙 T-9.2·T-9.3) ----
// done: 등록 코드는 이 응답 한 번만(복사 버튼 없음, 전화로만). validUntil은 서버가 만든 서울 시각 문구.
export type AdminResetField = 'check' | 'reason' | 'memo' | 'memo_long' | 'code_format' | 'code_wrong' | 'code_used';
export type AdminResetNotice = 'target_changed' | 'self' | 'log_failed' | 'unavailable' | 'rate_limited' | 'session' | 'need_mfa' | 'failed';
export type AdminResetState =
  | { done: true; ticket: string; validUntil: string }
  | { done: false; fields?: AdminResetField[]; notice?: AdminResetNotice; lock?: LockInfo }
  | undefined;
