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
  expect(simple.Subject?.Data).toBe('[바라 평생교육원] 이메일 인증을 완료해 주세요');
  expect(simple.Body?.Text?.Data).toContain('아래 링크를 눌러 이메일 인증을 완료해 주세요. 링크는 24시간 동안 유효해요.')
  expect(simple.Body?.Text?.Data).toContain('본인이 가입을 요청하지 않았다면 이 메일을 무시해 주세요.')
  expect(simple.Body?.Text?.Data).toContain('안녕하세요. 바라 평생교육원이에요.');
  expect(simple.Body?.Text?.Data).toContain('https://bara-edu.kr/auth/confirm?token=abc');
  expect(simple.Body?.Html?.Data).toContain('링크는 24시간 동안 유효해요.');
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
