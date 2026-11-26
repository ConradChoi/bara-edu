// profile_changed(회원 정보 변경 안내)는 링크가 없고(사기 메일로 보이지 않게, 전화로 연락하게 하려는 결정) `fields`(바뀐 항목)·`at`(수정 시각, 사람이 읽는 KST 문자열)를 쓴다.
// 이전·새 값은 메일에 싣지 않는다.
// password_changed(비밀번호 재설정 완료 알림, 대표 결정 2026-11-26 3번)도 같은 이유로 링크가 없고 `at`(변경 시각, kstStamp 형식)만 쓴다. 비밀번호는 싣지 않는다.
// already_registered는 로그인 link 외에 비밀번호 찾기 주소(`forgotLink`, `{origin}/forgot-password`)를 본문 줄로 싣는다.
// 나머지 템플릿은 link가 필수다.
export type MailMessage =
  | { to: string; template: 'confirm' | 'recovery'; link: string }
  | { to: string; template: 'already_registered'; link: string; forgotLink: string }
  | { to: string; template: 'profile_changed'; fields: ('name' | 'phone')[]; at: string; link?: undefined }
  | { to: string; template: 'password_changed'; at: string; link?: undefined };

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export class MemoryMailer implements Mailer {
  sent: MailMessage[] = [];

  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
  }
}
