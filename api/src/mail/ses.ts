import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import type { Mailer, MailMessage } from './mailer.js';

type Template = { subject: string; lead: string };

const TEMPLATES: Record<MailMessage['template'], Template> = {
  confirm: {
    subject: '[바라평생교육원] 이메일 인증을 완료해 주세요',
    lead: '아래 링크를 눌러 이메일 인증을 완료해 주세요. 링크는 24시간 동안 유효해요.',
  },
  recovery: {
    subject: '[바라평생교육원] 비밀번호 재설정 안내',
    lead: '아래 링크에서 새 비밀번호를 설정해 주세요. 링크는 1시간 동안 유효해요. 요청하지 않았다면 이 메일을 무시해 주세요.',
  },
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export class SesMailer implements Mailer {
  constructor(
    private readonly client: Pick<SESv2Client, 'send'>,
    private readonly from: string,
  ) {}

  async send(msg: MailMessage): Promise<void> {
    const t = TEMPLATES[msg.template];
    const link = escapeHtml(msg.link);
    const html = `<p>${escapeHtml(t.lead)}</p><p><a href="${link}">${link}</a></p>`;
    const text = `${t.lead}\n\n${msg.link}\n`;
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [msg.to] },
        Content: {
          Simple: {
            Subject: { Data: t.subject, Charset: 'UTF-8' },
            Body: { Html: { Data: html, Charset: 'UTF-8' }, Text: { Data: text, Charset: 'UTF-8' } },
          },
        },
      }),
    );
  }
}
