import { expect, test } from 'vitest';
import { devFakes } from '../src/dev-fakes.js';

test('플래그가 없으면 가짜 구현을 쓰지 않는다', () => {
  expect(devFakes({})).toBeNull();
  expect(devFakes({ BARA_DEV_FAKES: 'true' })).toBeNull();
});

test('운영(NODE_ENV=production)에서는 플래그가 있어도 시작을 거절', () => {
  expect(() => devFakes({ BARA_DEV_FAKES: '1', NODE_ENV: 'production' })).toThrow(/BARA_DEV_FAKES/);
});

test('실제 SES·S3 설정과 함께 쓰면 시작을 거절', () => {
  expect(() => devFakes({ BARA_DEV_FAKES: '1', MAIL_FROM: 'x@example.com' })).toThrow(/BARA_DEV_FAKES/);
  expect(() => devFakes({ BARA_DEV_FAKES: '1', S3_BUCKET: 'bucket' })).toThrow(/BARA_DEV_FAKES/);
});

test('플래그가 있으면 메모리 메일러·저장소, 메일 링크는 주소 없이 로그로 남긴다', async () => {
  const lines: string[] = [];
  const fakes = devFakes({ BARA_DEV_FAKES: '1' }, (l) => lines.push(l));
  expect(fakes).not.toBeNull();
  await fakes!.mailer.send({ to: 'a@example.com', template: 'confirm', link: 'http://localhost:3000/auth/confirm?token=t' });
  expect(fakes!.mailer.sent).toHaveLength(1);
  expect(lines).toEqual(['[dev-mail] confirm http://localhost:3000/auth/confirm?token=t']);
  await fakes!.storage.put('u/photo', Buffer.from('x'), 'image/png');
  expect(fakes!.storage.objects.has('u/photo')).toBe(true);
});
