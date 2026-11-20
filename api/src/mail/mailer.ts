export type MailMessage = { to: string; template: 'confirm' | 'recovery'; link: string };

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export class MemoryMailer implements Mailer {
  sent: MailMessage[] = [];

  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
  }
}
