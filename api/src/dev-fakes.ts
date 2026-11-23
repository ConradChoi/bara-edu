import { MemoryMailer, type MailMessage } from './mail/mailer.js';
import { MemoryStorage } from './storage/storage.js';

// 로컬 통합 확인 전용: SES·S3 대신 메모리 구현을 쓰고, 메일 링크는 로그로 확인한다.
export function devFakes(
  env: NodeJS.ProcessEnv,
  log: (line: string) => void = console.log,
): { mailer: MemoryMailer; storage: MemoryStorage } | null {
  if (env.BARA_DEV_FAKES !== '1') return null;
  // NODE_ENV alone is not a reliable guard: real mail or bucket settings also mean a real deployment
  if (env.NODE_ENV === 'production' || env.MAIL_FROM || env.S3_BUCKET) {
    throw new Error('BARA_DEV_FAKES must not be set in production or together with MAIL_FROM/S3_BUCKET');
  }
  const mailer = new MemoryMailer();
  const send = mailer.send.bind(mailer);
  mailer.send = async (msg: MailMessage) => {
    await send(msg);
    log(`[dev-mail] ${msg.template} ${msg.link}`);
  };
  return { mailer, storage: new MemoryStorage() };
}
