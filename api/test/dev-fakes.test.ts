import { expect, test } from 'vitest';
import { devFakes } from '../src/dev-fakes.js';

const LOCAL = ['http://localhost:3000'];

test('플래그가 없으면 가짜 구현을 쓰지 않는다', () => {
  expect(devFakes({}, LOCAL)).toBeNull();
  expect(devFakes({ BARA_DEV_FAKES: 'true' }, LOCAL)).toBeNull();
});

test('운영(NODE_ENV=production)에서는 플래그가 있어도 시작을 거절', () => {
  expect(() => devFakes({ BARA_DEV_FAKES: '1', NODE_ENV: 'production' }, LOCAL)).toThrow(/BARA_DEV_FAKES/);
});

test('실제 SES·S3 설정과 함께 쓰면 시작을 거절', () => {
  expect(() => devFakes({ BARA_DEV_FAKES: '1', MAIL_FROM: 'x@example.com' }, LOCAL)).toThrow(/BARA_DEV_FAKES/);
  expect(() => devFakes({ BARA_DEV_FAKES: '1', S3_BUCKET: 'bucket' }, LOCAL)).toThrow(/BARA_DEV_FAKES/);
});

test('SITE_ORIGINS에 로컬이 아닌 주소가 하나라도 있으면 시작을 거절', () => {
  for (const origins of [['https://bara-edu.kr'], ['http://localhost:3000', 'https://bara-edu.kr'], ['http://localhost.evil.com'], []]) {
    expect(() => devFakes({ BARA_DEV_FAKES: '1' }, origins)).toThrow(/SITE_ORIGINS/);
  }
});

test('플래그가 있으면 메모리 메일러·저장소, 메일 링크는 주소 없이 로그로 남긴다', async () => {
  const lines: string[] = [];
  const fakes = devFakes({ BARA_DEV_FAKES: '1' }, ['http://localhost:3000', 'http://127.0.0.1:3000'], (l) => lines.push(l));
  expect(fakes).not.toBeNull();
  await fakes!.mailer.send({ to: 'a@example.com', template: 'confirm', link: 'http://localhost:3000/auth/confirm?token=t' });
  expect(fakes!.mailer.sent).toHaveLength(1);
  expect(lines).toEqual(['[dev-mail] confirm http://localhost:3000/auth/confirm?token=t']);
  await fakes!.storage.put('u/photo', Buffer.from('x'), 'image/png');
  expect(fakes!.storage.objects.has('u/photo')).toBe(true);
});
