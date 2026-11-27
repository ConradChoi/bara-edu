import { expect, test } from 'vitest';
import type { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SesMailer } from '../src/mail/ses.js';
import { kstStamp } from '../src/mail/kst.js';

function fakeClient() {
  const sent: SendEmailCommand['input'][] = [];
  return { sent, client: { send: async (cmd: SendEmailCommand) => void sent.push(cmd.input) } as never };
}

const FROM = '바라평생교육원 <no-reply@bara-edu.kr>';

test('confirm 메일: 제목·받는사람·발신·링크, HTML과 텍스트 둘 다', async () => {
  const { sent, client } = fakeClient();
  await new SesMailer(client, FROM).send({ to: 'a@bara-edu.kr', template: 'confirm', link: 'https://bara-edu.kr/auth/confirm?token=abc' });
  expect(sent).toHaveLength(1);
  const input = sent[0];
  expect(input.FromEmailAddress).toBe(FROM);
  expect(input.Destination?.ToAddresses).toEqual(['a@bara-edu.kr']);
  const simple = input.Content!.Simple!;
  expect(simple.Subject?.Data).toBe('[바라 평생교육원] 가입을 마무리해 주세요');
  const text = simple.Body?.Text?.Data ?? '';
  expect(text).toContain('안녕하세요. 바라 평생교육원이에요.');
  // 링크를 열면 비밀번호를 입력해야 가입이 끝난다는 안내, 24시간(= auth.email_tokens confirm 만료, auth-signup.test.ts가 DB 값 확인)
  expect(text).toContain('아래 링크를 열고, 가입할 때 정한 비밀번호를 입력해 주세요. 그러면 가입이 끝나요. 링크는 24시간 동안 쓸 수 있어요.');
  expect(text).toContain('본인이 가입을 요청하지 않았다면 이 메일을 무시해 주세요. 아무것도 바뀌지 않아요.');
  expect(text).toContain('링크가 열리지 않으면 주소를 복사해 인터넷 창에 붙여 넣어 주세요.');
  expect(text.indexOf('https://bara-edu.kr/auth/confirm?token=abc')).toBeGreaterThan(text.indexOf('비밀번호를 입력해 주세요'));
  expect(text).not.toContain('이메일 인증');
  expect(simple.Body?.Html?.Data).toContain('링크는 24시간 동안 쓸 수 있어요.');
  expect(simple.Body?.Html?.Data).toContain('href="https://bara-edu.kr/auth/confirm?token=abc"');
});

test('recovery 메일: 제목·안내 문구(1시간·한 번만), 링크 뒤 복사 안내·로그아웃 안내', async () => {
  const { sent, client } = fakeClient();
  await new SesMailer(client, FROM).send({ to: 'b@bara-edu.kr', template: 'recovery', link: 'https://bara-edu.kr/reset-password?token=xyz' });
  const simple = sent[0].Content!.Simple!;
  expect(simple.Subject?.Data).toBe('[바라 평생교육원] 비밀번호 재설정 안내');
  const text = simple.Body?.Text?.Data ?? '';
  expect(text).toContain('아래 링크를 열고, 새 비밀번호를 정해 주세요. 링크는 1시간 동안 쓸 수 있고, 한 번만 쓸 수 있어요.');
  expect(text).toContain('본인이 요청하지 않았다면 이 메일을 무시해 주세요. 아무것도 바뀌지 않아요.');
  expect(text).toContain('링크가 열리지 않으면 주소를 복사해 인터넷 창에 붙여 넣어 주세요.');
  expect(text).toContain('비밀번호를 바꾸면 모든 기기에서 로그아웃돼요.');
  expect(text).not.toContain('유효해요');
  const linkAt = text.indexOf('https://bara-edu.kr/reset-password?token=xyz');
  expect(linkAt).toBeGreaterThan(text.indexOf('한 번만 쓸 수 있어요'));
  expect(text.indexOf('링크가 열리지 않으면')).toBeGreaterThan(linkAt);
  expect(text.indexOf('전화: ')).toBeGreaterThan(text.indexOf('모든 기기에서 로그아웃돼요'));
  expect(simple.Body?.Html?.Data).toContain('href="https://bara-edu.kr/reset-password?token=xyz"');
  expect(simple.Body?.Html?.Data).toContain('<p>링크가 열리지 않으면 주소를 복사해 인터넷 창에 붙여 넣어 주세요.</p>');
});

test('HTML 본문의 링크는 이스케이프되고 텍스트 본문은 원문 그대로', async () => {
  const { sent, client } = fakeClient();
  const link = 'https://bara-edu.kr/x?a=1&b="><script>alert(1)</script>';
  await new SesMailer(client, FROM).send({ to: 'c@bara-edu.kr', template: 'confirm', link });
  const body = sent[0].Content!.Simple!.Body!;
  expect(body.Html?.Data).not.toContain('<script>');
  expect(body.Html?.Data).toContain('a=1&amp;b=&quot;&gt;&lt;script&gt;');
  expect(body.Text?.Data).toContain(link);
});

test('SES 오류는 호출자에게 전달된다', async () => {
  const client = { send: async () => { throw new Error('ses down'); } } as never;
  await expect(new SesMailer(client, FROM).send({ to: 'd@bara-edu.kr', template: 'confirm', link: 'https://bara-edu.kr/' })).rejects.toThrow('ses down');
});

test('already_registered 메일: 제목·로그인 링크·비밀번호 찾기 주소·전화·운영시간', async () => {
  const { sent, client } = fakeClient();
  await new SesMailer(client, FROM).send({ to: 'e@bara-edu.kr', template: 'already_registered', link: 'https://bara-edu.kr/sign-in', forgotLink: 'https://bara-edu.kr/forgot-password' });
  const simple = sent[0].Content!.Simple!;
  expect(simple.Subject?.Data).toBe('[바라 평생교육원] 이미 가입된 이메일이에요');
  const text = simple.Body?.Text?.Data ?? '';
  expect(text).toContain('이 주소는 이미 가입되어 있어서 새로 가입하지 않았어요.');
  expect(text).toContain('https://bara-edu.kr/sign-in');
  // MAIL-REG-AFTER-1~3: 셀프 경로가 먼저, 전화는 그 뒤
  expect(text).toContain('비밀번호가 기억나지 않으면 아래 주소에서 새로 정할 수 있어요.\nhttps://bara-edu.kr/forgot-password\n주소가 열리지 않거나 어려우면 전화로 문의해 주세요.');
  expect(text).not.toContain('확인 후 재설정 메일을 보내 드려요');
  expect(text).not.toContain('{');
  expect(text.indexOf('https://bara-edu.kr/forgot-password')).toBeGreaterThan(text.indexOf('https://bara-edu.kr/sign-in'));
  expect(text.indexOf('전화: ')).toBeGreaterThan(text.indexOf('주소가 열리지 않거나'));
  expect(text).toContain('010-9025-5093');
  expect(text).toContain('운영시간: 평일 10:00~18:00(점심 11:30~13:00 제외)');
  expect(text).toContain('본인이 가입을 시도한 것이 아니라면 이 메일을 무시해 주세요.');
  const html = simple.Body?.Html?.Data ?? '';
  expect(html).toContain('href="https://bara-edu.kr/sign-in"');
  expect(html).toContain('<p><a href="https://bara-edu.kr/forgot-password">https://bara-edu.kr/forgot-password</a></p>');
});

test('already_registered 메일: 비밀번호 찾기 주소도 HTML에서 이스케이프된다', async () => {
  const { sent, client } = fakeClient();
  await new SesMailer(client, FROM).send({ to: 'e@bara-edu.kr', template: 'already_registered', link: 'https://bara-edu.kr/sign-in', forgotLink: 'https://bara-edu.kr/"><script>x</script>' });
  const html = sent[0].Content!.Simple!.Body!.Html?.Data ?? '';
  expect(html).not.toContain('<script>');
  expect(html).toContain('&quot;&gt;&lt;script&gt;');
});

test('password_changed 메일: 확정 문구, 바뀐 시각, 링크 없음, 문의처는 공통 블록', async () => {
  const { sent, client } = fakeClient();
  await new SesMailer(client, FROM).send({ to: 'g@bara-edu.kr', template: 'password_changed', at: '2026년 11월 26일 오후 2시 12분' });
  expect(sent[0].Destination?.ToAddresses).toEqual(['g@bara-edu.kr']);
  const simple = sent[0].Content!.Simple!;
  expect(simple.Subject?.Data).toBe('[바라 평생교육원] 비밀번호가 바뀌었어요');
  const text = simple.Body?.Text?.Data ?? '';
  expect(text).toBe(
    [
      '안녕하세요. 바라 평생교육원이에요.',
      '',
      '회원님의 비밀번호가 바뀌어서 알려 드려요.',
      '바뀐 시각: 2026년 11월 26일 오후 2시 12분',
      '보안을 위해 모든 기기에서 로그아웃했어요. 새 비밀번호로 다시 로그인해 주세요.',
      '회원님이 직접 바꾼 것이 맞다면 따로 하실 일은 없어요.',
      '',
      '본인이 바꾸지 않았다면 바로 전화로 알려 주세요.',
      '',
      '전화: 010-9025-5093',
      '운영시간: 평일 10:00~18:00(점심 11:30~13:00 제외)',
      '',
      '바라 평생교육원',
      '',
    ].join('\n'),
  );
  expect(text).not.toContain('http');
  const html = simple.Body?.Html?.Data ?? '';
  expect(html).not.toContain('<a ');
  expect(html).not.toContain('href');
  expect(html).toContain('<p>바뀐 시각: 2026년 11월 26일 오후 2시 12분</p>');
});

test('운영시간이 비어 있으면 그 줄을 뺀다', async () => {
  const { sent, client } = fakeClient();
  await new SesMailer(client, FROM, { phone: '010-1111-2222', hours: '' }).send({ to: 'f@bara-edu.kr', template: 'already_registered', link: 'https://bara-edu.kr/sign-in', forgotLink: 'https://bara-edu.kr/forgot-password' });
  const body = sent[0].Content!.Simple!.Body!;
  expect(body.Text?.Data).toContain('010-1111-2222');
  expect(body.Text?.Data).not.toContain('운영시간');
  expect(body.Html?.Data).not.toContain('운영시간');
});

test('profile_changed 메일: 확정 문구, 링크 없음, 항목명·시각·고객센터 연락처, 값은 없다', async () => {
  const { sent, client } = fakeClient();
  await new SesMailer(client, FROM).send({ to: 'f@bara-edu.kr', template: 'profile_changed', fields: ['name', 'phone'], at: '2026년 11월 26일 오후 2시 12분' });
  const simple = sent[0].Content!.Simple!;
  expect(simple.Subject?.Data).toBe('[바라 평생교육원] 회원 정보가 바뀌었어요');
  const text = simple.Body?.Text?.Data ?? '';
  expect(text).toContain('회원님의 정보가 바뀌어서 알려 드려요.');
  expect(text).toContain('바뀐 항목: 이름, 휴대전화');
  expect(text).toContain('바뀐 시각: 2026년 11월 26일 오후 2시 12분');
  expect(text).toContain('바뀐 내용은 개인정보를 지키기 위해 이 메일에 적지 않았어요.');
  expect(text).toContain('본인이 요청하지 않았다면 전화로 알려 주세요.');
  expect(text).toContain('전화: ');
  expect(text).not.toContain('{');
  expect(text).not.toContain('http');
  expect(text.indexOf('본인이 요청하지 않았다면')).toBeLessThan(text.indexOf('전화: '));
  expect(simple.Body?.Html?.Data).not.toContain('<a ');
  await new SesMailer(client, FROM).send({ to: 'f@bara-edu.kr', template: 'profile_changed', fields: ['phone'], at: 'x' });
  expect(sent[1].Content!.Simple!.Body?.Text?.Data).toContain('바뀐 항목: 휴대전화');
});

test('kstStamp: profile_changed·password_changed의 {at} 형식(KST, 12시간제)', () => {
  expect(kstStamp(new Date('2026-11-26T05:12:00Z'))).toBe('2026년 11월 26일 오후 2시 12분');
  expect(kstStamp(new Date('2026-11-25T15:05:00Z'))).toBe('2026년 11월 26일 오전 12시 5분');
  expect(kstStamp(new Date('2026-11-26T03:00:00Z'))).toBe('2026년 11월 26일 오후 12시 0분');
});

test('admin_security_alert: 개발 담당이 서버에서 한 일(ticket_issued·unlocked)은 요청 확인 안내, 그 밖의 사건은 기존 안내(TOTP 후속 R-2)', async () => {
  const { sent, client } = fakeClient();
  const m = new SesMailer(client, FROM);
  for (const event of ['ticket_issued', 'unlocked', 'reset'] as const) {
    await m.send({ to: 'dev@example.com', template: 'admin_security_alert', at: '2026년 11월 27일 오후 1시', ownerName: '대표', event });
  }
  const text = (i: number) => sent[i].Content!.Simple!.Body?.Text?.Data ?? '';
  expect(text(0)).toContain('사건: 개발 담당이 서버에서 2단계 인증 등록 코드를 발급했어요.');
  expect(text(1)).toContain('사건: 개발 담당이 서버에서 인증 앱 번호 입력 잠금을 풀었어요.');
  for (const i of [0, 1]) {
    expect(text(i)).toContain('대표님이 개발 담당에게 직접 요청한 것이 맞는지 대표님에게 전화로 확인해 주세요.');
    expect(text(i)).not.toContain('2단계 인증을 초기화하고');
    expect(text(i)).not.toMatch(/\d{4}\s?\d{4}/); // 등록 코드 모양 없음
  }
  expect(text(2)).toContain('본인이 한 일이 아니라면 관리자 화면에서 대표님의 2단계 인증을 초기화하고');
});

test('관리자 전용 연락처(ADMIN_CONTACT_PHONE): 관리자 메일만 문의처를 "관리자 문의(개발 담당) 전화" 한 줄로, 회원 메일은 공통 블록', async () => {
  const ADMIN = '010-3333-4444';
  const at = '2026년 11월 27일 오후 4시 0분';
  const adminMails = [
    { to: 'a@x.kr', template: 'mfa_enrolled', at },
    { to: 'a@x.kr', template: 'mfa_reset', at, by: 'admin' },
    { to: 'a@x.kr', template: 'mfa_recovery_used', at, left: 3 },
    { to: 'a@x.kr', template: 'mfa_locked', at, scope: 'account', minutes: 15 },
    { to: 'a@x.kr', template: 'mfa_locked', at, scope: 'daily', minutes: 1440 },
    { to: 'a@x.kr', template: 'admin_security_alert', at, ownerName: '홍길동', event: 'reset' },
    { to: 'a@x.kr', template: 'admin_security_alert', at, ownerName: '홍길동', event: 'unlocked' },
    { to: 'a@x.kr', template: 'password_changed', at, adminLine: true },
  ] as const;
  for (const msg of adminMails) {
    const { sent, client } = fakeClient();
    await new SesMailer(client, FROM, undefined, ADMIN).send(msg);
    const body = sent[0].Content!.Simple!.Body!;
    const text = body.Text?.Data ?? '';
    expect(text, msg.template).toContain(`관리자 문의(개발 담당) 전화: ${ADMIN}`);
    expect(text, msg.template).not.toContain('010-9025-5093');
    expect(text, msg.template).not.toContain('운영시간');
    expect(body.Html?.Data ?? '', msg.template).toContain(`<p>관리자 문의(개발 담당) 전화: ${ADMIN}</p>`);
  }
  const memberMails = [
    { to: 'm@x.kr', template: 'password_changed', at },
    { to: 'm@x.kr', template: 'password_changed', at, adminLine: false },
    { to: 'm@x.kr', template: 'confirm', link: 'https://bara-edu.kr/auth/confirm?token=t' },
    { to: 'm@x.kr', template: 'profile_changed', fields: ['phone'], at },
    // 로그인 없이도 요청되는 메일은 받는 사람이 관리자여도 공통 블록(개인정보 점검 권고 4)
    { to: 'a@x.kr', template: 'recovery', link: 'https://bara-edu.kr/reset-password?token=t' },
    { to: 'a@x.kr', template: 'already_registered', link: 'https://bara-edu.kr/sign-in', forgotLink: 'https://bara-edu.kr/forgot-password' },
  ] as const;
  for (const msg of memberMails) {
    const { sent, client } = fakeClient();
    await new SesMailer(client, FROM, undefined, ADMIN).send(msg);
    const text = sent[0].Content!.Simple!.Body!.Text?.Data ?? '';
    expect(text, msg.template).toContain('전화: 010-9025-5093');
    expect(text, msg.template).not.toContain(ADMIN);
  }
  // 설정이 없으면 관리자 메일도 공통 블록 그대로(지금과 같음)
  const { sent, client } = fakeClient();
  await new SesMailer(client, FROM).send(adminMails[0]);
  const text = sent[0].Content!.Simple!.Body!.Text?.Data ?? '';
  expect(text).toContain('전화: 010-9025-5093');
  expect(text).toContain('운영시간: ');
  expect(text).not.toContain('관리자 문의');
});
