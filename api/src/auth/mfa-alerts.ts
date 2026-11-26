import type { Tx } from '../db/context.js';
import type { MailMessage, SecurityAlertEvent } from '../mail/mailer.js';

// 보안 알림 수신자(기획서 2.13, 보안 점검 I-6). 위협 모델이 "메일함 탈취"라서 본인 메일함에만 보내지 않는다.
// 1) 본인(가입 이메일), 2) 사건 주인이 아닌 활성·인증 완료 관리자 전원(초기화를 처리한 관리자 포함), 3) ADMIN_SECURITY_ALERT_TO.
// 2·3이 모두 없으면 본인에게만 보내고 selfOnly=true(접속 기록 detail에 ;alert=self_only). 수신자는 사건을 처리하는 트랜잭션 안에서 계산하고,
// 호출한 쪽이 커밋 뒤에 한 사람에게 한 통씩 큐에 넣는다(받는 사람 목록을 서로 노출하지 않는다).

const UNDELIVERABLE = /@deleted\.invalid$/;

export type AlertPlan = { messages: MailMessage[]; selfOnly: boolean };

type OwnMail = Exclude<MailMessage, { template: 'confirm' | 'recovery' | 'already_registered' | 'profile_changed' | 'admin_security_alert' }>;
type DistributedOwnMail = OwnMail extends infer M ? (M extends MailMessage ? Omit<M, 'to'> : never) : never;

export async function planAlertsIn(
  tx: Tx,
  ownerId: string,
  alertTo: readonly string[],
  event: { own: DistributedOwnMail | null; alert: SecurityAlertEvent; at: string; left?: number },
): Promise<AlertPlan> {
  const owner = await tx.query<{ email: string; name: string | null }>(
    'select u.email, p.name from auth.users u left join public.profiles p on p.id = u.id where u.id = $1',
    [ownerId],
  );
  const ownerEmail = owner.rows[0]?.email?.toLowerCase() ?? null;
  const ownerName = owner.rows[0]?.name ?? '';
  const others = await tx.query<{ email: string }>(
    `select lower(u.email) as email from public.profiles p join auth.users u on u.id = p.id
      where p.role = 'admin' and p.status = 'active' and u.email_confirmed_at is not null and p.id <> $1
      order by u.email`,
    [ownerId],
  );
  const recipients: string[] = [];
  for (const e of [...others.rows.map((r) => r.email), ...alertTo]) {
    if (e && e !== ownerEmail && !UNDELIVERABLE.test(e) && !recipients.includes(e)) recipients.push(e);
  }
  const messages: MailMessage[] = [];
  if (event.own && ownerEmail && !UNDELIVERABLE.test(ownerEmail)) messages.push({ ...event.own, to: ownerEmail } as MailMessage);
  for (const to of recipients) {
    messages.push({ to, template: 'admin_security_alert', at: event.at, ownerName, event: event.alert, ...(event.left !== undefined ? { left: event.left } : {}) });
  }
  return { messages, selfOnly: recipients.length === 0 };
}

export const selfOnlySuffix = (plan: AlertPlan) => (plan.selfOnly ? ';alert=self_only' : '');
