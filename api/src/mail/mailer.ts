// profile_changed(회원 정보 수정 안내)만 `fields`(바뀐 항목)·`at`(수정 시각, 사람이 읽는 KST 문자열)를 쓴다. 이전·새 값은 메일에 싣지 않는다.
export type MailMessage = {
  to: string;
  template: 'confirm' | 'recovery' | 'already_registered' | 'profile_changed';
  link: string;
  fields?: ('name' | 'phone')[];
  at?: string;
};

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export class MemoryMailer implements Mailer {
  sent: MailMessage[] = [];

  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
  }
}
