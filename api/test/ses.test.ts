import { expect, test } from 'vitest';
import type { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SesMailer } from '../src/mail/ses.js';

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

test('recovery 메일: 제목·안내 문구', async () => {
  const { sent, client } = fakeClient();
  await new SesMailer(client, FROM).send({ to: 'b@bara-edu.kr', template: 'recovery', link: 'https://bara-edu.kr/reset-password?token=xyz' });
  const simple = sent[0].Content!.Simple!;
  expect(simple.Subject?.Data).toBe('[바라 평생교육원] 비밀번호 재설정 안내');
  expect(simple.Body?.Text?.Data).toContain('아래 링크에서 새 비밀번호를 설정해 주세요. 링크는 1시간 동안 유효해요. 요청하지 않았다면 이 메일을 무시해 주세요.');
  expect(simple.Body?.Html?.Data).toContain('https://bara-edu.kr/reset-password?token=xyz');
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

test('already_registered 메일: 제목·로그인 링크·전화·운영시간·재설정 문장', async () => {
  const { sent, client } = fakeClient();
  await new SesMailer(client, FROM).send({ to: 'e@bara-edu.kr', template: 'already_registered', link: 'https://bara-edu.kr/sign-in' });
  const simple = sent[0].Content!.Simple!;
  expect(simple.Subject?.Data).toBe('[바라 평생교육원] 이미 가입된 이메일이에요');
  const text = simple.Body?.Text?.Data ?? '';
  expect(text).toContain('이 주소는 이미 가입되어 있어서 새로 가입하지 않았어요.');
  expect(text).toContain('https://bara-edu.kr/sign-in');
  expect(text).toContain('비밀번호가 기억나지 않으면 전화로 문의해 주세요. 확인 후 재설정 메일을 보내 드려요.');
  expect(text).toContain('010-9025-5093');
  expect(text).toContain('운영시간: 평일 10:00~18:00(점심 11:30~13:00 제외)');
  expect(text).toContain('본인이 가입을 시도한 것이 아니라면 이 메일을 무시해 주세요.');
  expect(simple.Body?.Html?.Data).toContain('href="https://bara-edu.kr/sign-in"');
});

test('운영시간이 비어 있으면 그 줄을 뺀다', async () => {
  const { sent, client } = fakeClient();
  await new SesMailer(client, FROM, { phone: '010-1111-2222', hours: '' }).send({ to: 'f@bara-edu.kr', template: 'already_registered', link: 'https://bara-edu.kr/sign-in' });
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
