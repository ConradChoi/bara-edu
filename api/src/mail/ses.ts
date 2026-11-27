import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import type { Mailer, MailMessage } from './mailer.js';
import { SUPPORT_HOURS, SUPPORT_PHONE } from './support.js';

// intro: 링크 앞 문단, after: 링크 뒤 문단(문의처 앞), closing: 문의처 뒤 문단
type Template = { subject: string; intro: string[]; after: string[]; closing: string[] };

const GREETING = '안녕하세요. 바라 평생교육원이에요.';
const SIGNATURE = '바라 평생교육원';
// 이 값만 있는 줄은 already_registered의 forgotLink로 바꾸고 HTML에서는 <a>로 감싼다
const FORGOT_LINK = '{forgotLink}';

// 관리자 보안 알림의 공통 끝 문장(카피 7.1~7.4 AFTER). 관리자 메일도 공통 문의처 블록을 그대로 쓴다(1.3 D4).
const MFA_TEMPLATES = {
  // MFA-MAIL-ENROLLED-*
  mfa_enrolled: {
    subject: '[바라 평생교육원] 2단계 인증이 등록됐어요',
    intro: [
      '관리자 계정에 2단계 인증이 등록됐어요.',
      '등록 시각: {at}',
      '앞으로 로그인할 때 비밀번호와 함께 인증 앱의 6자리 번호가 필요해요.',
      '직접 등록한 것이 맞다면 따로 하실 일은 없어요.',
    ],
    after: ['본인이 등록하지 않았다면 바로 다른 관리자 또는 개발 담당에게 전화로 알려 주세요.'],
    closing: [],
  },
  // MFA-MAIL-RESET-* ({by}: INTRO-3 / INTRO-3-DB)
  mfa_reset: {
    subject: '[바라 평생교육원] 2단계 인증이 초기화됐어요',
    intro: [
      '관리자 계정의 2단계 인증이 초기화됐어요.',
      '초기화 시각: {at}',
      '{resetBy}',
      '다음에 로그인할 때 인증 앱을 새로 등록해야 해요. 이때 등록 코드가 필요해요. 등록 코드는 전화로만 알려 드려요.',
      '직접 요청한 것이 맞다면 따로 하실 일은 없어요.',
    ],
    after: ['요청하지 않았다면 바로 다른 관리자 또는 개발 담당에게 전화로 알려 주세요.'],
    closing: ['이 메일로는 2단계 인증을 초기화하거나 등록 코드를 받을 수 없어요.'],
  },
  // MFA-MAIL-RECOVERY-* ({left}: INTRO-3 / INTRO-3-ZERO)
  mfa_recovery_used: {
    subject: '[바라 평생교육원] 복구 코드로 로그인했어요',
    intro: [
      '관리자 계정에 복구 코드로 로그인한 기록이 있어요.',
      '로그인 시각: {at}',
      '{left}',
      '휴대폰을 쓸 수 없어서 직접 로그인한 것이 맞다면 따로 하실 일은 없어요. 다시 쓸 수 있게 되면 인증 앱을 새로 등록해 주세요.',
    ],
    after: ['본인이 로그인하지 않았다면 바로 다른 관리자 또는 개발 담당에게 전화로 알려 주세요.'],
    closing: [],
  },
  // MFA-MAIL-LOCKED-* (15분) — 24시간은 mfa_locked_daily
  mfa_locked: {
    subject: '[바라 평생교육원] 인증 앱 번호가 여러 번 틀렸어요',
    intro: [
      '관리자 계정에 비밀번호는 맞게 입력됐지만, 인증 앱 번호가 여러 번 틀렸어요.',
      '확인 시각: {at}',
      '안전을 위해 {m}분 동안 이 계정의 번호 입력을 막았어요.',
      '직접 입력하다 틀린 것이라면 {m}분 뒤에 다시 시도해 주세요. 따로 하실 일은 없어요.',
    ],
    after: [
      '본인이 시도한 것이 아니라면 비밀번호를 새로 정해 주세요. 로그인 화면의 [비밀번호를 잊으셨나요?]에서 할 수 있어요.',
      '이런 메일이 계속 오면 다른 관리자 또는 개발 담당에게 전화로 알려 주세요.',
    ],
    closing: [],
  },
  // MFA-MAIL-ALERT-* ({name}, {event})
  admin_security_alert: {
    subject: '[바라 평생교육원] 관리자 {name}님 계정 보안 알림',
    intro: [
      '관리자 {name}님 계정에서 아래 일이 있었어요.',
      '사건: {event}',
      '시각: {at}',
      '이 계정의 메일함을 다른 사람이 열 수도 있어서, 다른 관리자에게도 같은 내용을 알려 드려요.',
    ],
    after: [
      '{name}님에게 전화로 직접 한 일이 맞는지 확인해 주세요. 메일이나 메신저로 묻지 마세요.',
      '본인이 한 일이 아니라면 관리자 화면에서 {name}님의 2단계 인증을 초기화하고, 개발 담당에게 알려 주세요.',
    ],
    closing: ["자세한 기록은 관리자 화면 첫 페이지의 '최근 보안 이벤트'에서 볼 수 있어요."],
  },
} satisfies Record<string, Template>;

// MFA-MAIL-LOCKED-DAILY-INTRO-3·4
const LOCKED_DAILY_INTRO = [
  '하루 동안 번호가 너무 많이 틀려서, 안전을 위해 24시간 동안 이 계정의 번호 입력을 막았어요.',
  '직접 입력하다 틀린 것이라면 다른 관리자 또는 개발 담당에게 연락해 주세요. 개발 담당이 잠금을 풀 수 있어요.',
];
// MFA-MAIL-CHANGED-ADMIN-LINE
export const PASSWORD_CHANGED_ADMIN_LINE = '2단계 인증은 그대로예요. 로그인할 때 인증 앱의 6자리 번호가 필요해요.';
const RESET_BY = { admin: '다른 관리자가 초기화했어요. 모든 기기에서 로그아웃됐어요.', db: '관리자 또는 개발 담당이 초기화했어요. 모든 기기에서 로그아웃됐어요.' } as const;
export const ALERT_EVENT_TEXT = {
  enrolled: '2단계 인증을 등록했어요(인증 앱 바꾸기 포함).',
  reset: '2단계 인증이 초기화됐어요.',
  recovery_used: '복구 코드로 로그인했어요. 남은 복구 코드: {n}개',
  locked: '인증 앱 번호가 여러 번 틀려 15분 동안 막혔어요.',
  locked_daily: '인증 앱 번호가 너무 많이 틀려 24시간 동안 막혔어요.',
  password_reset: '비밀번호 재설정 메일로 비밀번호를 바꿨어요.',
  // 운영 서버 명령(CLI)으로 한 일(보안 점검 m-3, 2026-11-27)
  ticket_issued: '개발 담당이 서버에서 2단계 인증 등록 코드를 발급했어요.',
  unlocked: '개발 담당이 서버에서 인증 앱 번호 입력 잠금을 풀었어요.',
} as const;

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ');

// 메시지마다 고를 문단(변형 문구 포함)
function templateFor(msg: MailMessage): Template {
  switch (msg.template) {
    case 'password_changed':
      return msg.adminLine ? { ...TEMPLATES.password_changed, intro: [...TEMPLATES.password_changed.intro, PASSWORD_CHANGED_ADMIN_LINE] } : TEMPLATES.password_changed;
    case 'mfa_locked':
      return msg.scope === 'daily' ? { ...MFA_TEMPLATES.mfa_locked, intro: [...MFA_TEMPLATES.mfa_locked.intro.slice(0, 2), ...LOCKED_DAILY_INTRO] } : MFA_TEMPLATES.mfa_locked;
    case 'mfa_enrolled':
    case 'mfa_reset':
    case 'mfa_recovery_used':
    case 'admin_security_alert':
      return MFA_TEMPLATES[msg.template];
    default:
      return TEMPLATES[msg.template];
  }
}

function vars(msg: MailMessage): Record<string, string> {
  const v: Record<string, string> = {};
  if ('at' in msg && typeof msg.at === 'string') v['{at}'] = msg.at;
  if (msg.template === 'mfa_reset') v['{resetBy}'] = RESET_BY[msg.by];
  if (msg.template === 'mfa_recovery_used') v['{left}'] = msg.left > 0 ? `남은 복구 코드: ${msg.left}개` : '남은 복구 코드: 없음';
  if (msg.template === 'mfa_locked') v['{m}'] = String(msg.minutes);
  if (msg.template === 'admin_security_alert') {
    v['{name}'] = oneLine(msg.ownerName);
    v['{event}'] = ALERT_EVENT_TEXT[msg.event].replace('{n}', String(msg.left ?? 0));
  }
  return v;
}

const TEMPLATES: Record<'confirm' | 'recovery' | 'already_registered' | 'profile_changed' | 'password_changed', Template> = {
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
  // 문구: docs/02-design/features/bara-edu-lms.password-reset-request-copy.md 5.2 (MAIL-RECOVERY-*). 관리자 발송도 같은 템플릿.
  recovery: {
    subject: '[바라 평생교육원] 비밀번호 재설정 안내',
    intro: [
      '아래 링크를 열고, 새 비밀번호를 정해 주세요. 링크는 1시간 동안 쓸 수 있고, 한 번만 쓸 수 있어요.',
      '본인이 요청하지 않았다면 이 메일을 무시해 주세요. 아무것도 바뀌지 않아요.',
    ],
    after: ['링크가 열리지 않으면 주소를 복사해 인터넷 창에 붙여 넣어 주세요.', '비밀번호를 바꾸면 모든 기기에서 로그아웃돼요.'],
    closing: [],
  },
  // 문구: 같은 카피 문서 5.3 (MAIL-REG-AFTER-*). {forgotLink} 줄은 HTML에서 링크로 만든다.
  already_registered: {
    subject: '[바라 평생교육원] 이미 가입된 이메일이에요',
    intro: ['이 이메일 주소로 회원가입 요청이 있었어요.', '이 주소는 이미 가입되어 있어서 새로 가입하지 않았어요.', '아래 링크에서 로그인해 주세요.'],
    after: ['비밀번호가 기억나지 않으면 아래 주소에서 새로 정할 수 있어요.', FORGOT_LINK, '주소가 열리지 않거나 어려우면 전화로 문의해 주세요.'],
    closing: ['본인이 가입을 시도한 것이 아니라면 이 메일을 무시해 주세요. 아무것도 바뀌지 않아요.'],
  },
  // 문구: 같은 카피 문서 5.1 (MAIL-CHANGED-*). {at}는 profile_changed와 같은 kstStamp 형식. 링크 없음, 비밀번호는 싣지 않는다.
  password_changed: {
    subject: '[바라 평생교육원] 비밀번호가 바뀌었어요',
    intro: [
      '회원님의 비밀번호가 바뀌어서 알려 드려요.',
      '바뀐 시각: {at}',
      '보안을 위해 모든 기기에서 로그아웃했어요. 새 비밀번호로 다시 로그인해 주세요.',
      '회원님이 직접 바꾼 것이 맞다면 따로 하실 일은 없어요.',
    ],
    after: ['본인이 바꾸지 않았다면 바로 전화로 알려 주세요.'],
    closing: [],
  },
};

const FIELD_LABEL = { name: '이름', phone: '휴대전화' } as const;
const fill = (line: string, msg: MailMessage) => {
  let out = line
    .replace('{fields}', (msg.template === 'profile_changed' ? msg.fields : []).map((f) => FIELD_LABEL[f]).join(', '))
    .replace(FORGOT_LINK, msg.template === 'already_registered' ? msg.forgotLink : '');
  for (const [k, val] of Object.entries(vars(msg))) out = out.split(k).join(val);
  return out.replace('{at}', '');
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export type SupportInfo = { phone: string; hours: string };

export class SesMailer implements Mailer {
  constructor(
    private readonly client: Pick<SESv2Client, 'send'>,
    private readonly from: string,
    private readonly support: SupportInfo = { phone: SUPPORT_PHONE, hours: SUPPORT_HOURS },
  ) {}

  async send(msg: MailMessage): Promise<void> {
    const tpl = templateFor(msg);
    const t = { ...tpl, subject: fill(tpl.subject, msg), intro: tpl.intro.map((l) => fill(l, msg)), after: tpl.after.map((l) => fill(l, msg)), closing: tpl.closing.map((l) => fill(l, msg)) };
    const contact = [`전화: ${this.support.phone}`, ...(this.support.hours ? [`운영시간: ${this.support.hours}`] : [])];
    const link = msg.link === undefined ? null : escapeHtml(msg.link);
    const anchor = (href: string) => `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`;
    const p = (lines: string[]) => lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('');
    const afterHtml = tpl.after.map((raw, i) => (raw === FORGOT_LINK ? `<p>${anchor(t.after[i])}</p>` : `<p>${escapeHtml(t.after[i])}</p>`)).join('');
    const html =
      p([GREETING, ...t.intro]) + (link === null ? '' : `<p><a href="${link}">${link}</a></p>`) + afterHtml +
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
