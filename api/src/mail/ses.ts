import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import type { Mailer, MailMessage } from './mailer.js';
import { SUPPORT_HOURS, SUPPORT_PHONE } from './support.js';

// intro: 링크 앞 문단, after: 링크 뒤 문단(문의처 앞), closing: 문의처 뒤 문단
type Template = { subject: string; intro: string[]; after: string[]; closing: string[] };

const GREETING = '안녕하세요. 바라 평생교육원이에요.';
const SIGNATURE = '바라 평생교육원';

const TEMPLATES: Record<MailMessage['template'], Template> = {
  // 문구: docs/02-design/features/bara-edu-lms.admin-profile-edit-copy.md 6장. {fields}·{at}는 보낼 때 채운다. 링크 없음. 바뀐 값은 싣지 않는다.
  profile_changed: {
    subject: '[바라 평생교육원] 회원 정보가 바뀌었어요',
    intro: [
      '회원님의 정보가 바뀌어서 알려 드려요.',
      '고객센터에서 회원님의 정보를 고쳤어요.',
      '바뀐 항목: {fields}',
      '바뀐 시각: {at}',
      '바뀐 내용은 개인정보를 지키기 위해 이 메일에 적지 않았어요.',
      '회원님이 고객센터에 전화해서 요청한 것이 맞다면 따로 하실 일은 없어요.',
    ],
    after: ['본인이 요청하지 않았다면 전화로 알려 주세요.'],
    closing: [],
  },
  confirm: {
    subject: '[바라 평생교육원] 가입을 마무리해 주세요',
    intro: [
      '아래 링크를 열고, 가입할 때 정한 비밀번호를 입력해 주세요. 그러면 가입이 끝나요. 링크는 24시간 동안 쓸 수 있어요.',
      '본인이 가입을 요청하지 않았다면 이 메일을 무시해 주세요. 아무것도 바뀌지 않아요.',
    ],
    after: ['링크가 열리지 않으면 주소를 복사해 인터넷 창에 붙여 넣어 주세요.'],
    closing: [],
  },
  recovery: {
    subject: '[바라 평생교육원] 비밀번호 재설정 안내',
    intro: ['아래 링크에서 새 비밀번호를 설정해 주세요. 링크는 1시간 동안 유효해요. 요청하지 않았다면 이 메일을 무시해 주세요.'],
    after: [],
    closing: [],
  },
  already_registered: {
    subject: '[바라 평생교육원] 이미 가입된 이메일이에요',
    intro: ['이 이메일 주소로 회원가입 요청이 있었어요.', '이 주소는 이미 가입되어 있어서 새로 가입하지 않았어요.', '아래 링크에서 로그인해 주세요.'],
    after: ['비밀번호가 기억나지 않으면 전화로 문의해 주세요. 확인 후 재설정 메일을 보내 드려요.'],
    closing: ['본인이 가입을 시도한 것이 아니라면 이 메일을 무시해 주세요. 아무것도 바뀌지 않아요.'],
  },
};

const FIELD_LABEL = { name: '이름', phone: '휴대전화' } as const;
const fill = (line: string, msg: MailMessage) =>
  line.replace('{fields}', (msg.template === 'profile_changed' ? msg.fields : []).map((f) => FIELD_LABEL[f]).join(', ')).replace('{at}', msg.template === 'profile_changed' ? msg.at : '');

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export type SupportInfo = { phone: string; hours: string };

export class SesMailer implements Mailer {
  constructor(
    private readonly client: Pick<SESv2Client, 'send'>,
    private readonly from: string,
    private readonly support: SupportInfo = { phone: SUPPORT_PHONE, hours: SUPPORT_HOURS },
  ) {}

  async send(msg: MailMessage): Promise<void> {
    const tpl = TEMPLATES[msg.template];
    const t = { ...tpl, intro: tpl.intro.map((l) => fill(l, msg)) };
    const contact = [`전화: ${this.support.phone}`, ...(this.support.hours ? [`운영시간: ${this.support.hours}`] : [])];
    const link = msg.link === undefined ? null : escapeHtml(msg.link);
    const p = (lines: string[]) => lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('');
    const html =
      p([GREETING, ...t.intro]) + (link === null ? '' : `<p><a href="${link}">${link}</a></p>`) + p(t.after) +
      `<p>${contact.map(escapeHtml).join('<br>')}</p>` + p(t.closing) + p([SIGNATURE]);
    const text = [GREETING, '', ...t.intro, '', ...(msg.link === undefined ? [] : [msg.link, '']), ...(t.after.length ? [...t.after, ''] : []), ...contact, '', ...(t.closing.length ? [...t.closing, ''] : []), SIGNATURE, ''].join('\n');
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
