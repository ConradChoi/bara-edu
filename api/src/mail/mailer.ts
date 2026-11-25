// profile_changed(회원 정보 변경 안내)는 링크가 없고(사기 메일로 보이지 않게, 전화로 연락하게 하려는 결정) `fields`(바뀐 항목)·`at`(수정 시각, 사람이 읽는 KST 문자열)를 쓴다.
// 이전·새 값은 메일에 싣지 않는다. 나머지 템플릿은 link가 필수다.
export type MailMessage =
  | { to: string; template: 'confirm' | 'recovery' | 'already_registered'; link: string }
  | { to: string; template: 'profile_changed'; fields: ('name' | 'phone')[]; at: string; link?: undefined };

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export class MemoryMailer implements Mailer {
  sent: MailMessage[] = [];

  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
  }
}
