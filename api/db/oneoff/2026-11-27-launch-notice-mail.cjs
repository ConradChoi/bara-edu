// 정식 오픈 회원 안내 메일 1회 발송 (2026-11-27). 근거: 정식 오픈 계획 docs/01-plan/features/bara-edu-lms.launch-v1.md(개인정보 점검 4-3).
// 받는 사람: 이메일 인증을 마친 활성 학습자(role=learner, status=active)의 가입 이메일(인증 전 가입 대기자는 제외, QA). 관리자는 제외. 광고 아님(처리방침·약관 게시 안내).
// 실행(WAS, api 폴더 안): node 2026-11-27-launch-notice-mail.cjs            → 받을 사람 수만 출력(기본)
//                        node 2026-11-27-launch-notice-mail.cjs --send --expect=<n>  → 받는 사람 수가 n일 때만 한 명씩 따로 보냄(받는 사람끼리 주소가 보이지 않게)
// 출력에는 건수만 나온다(주소 없음). 발송 이력을 남기지 않으므로 --send는 한 번만 실행한다(일부 실패해도 다시 돌리지 말고 실패 건수만 보고 따로 처리, QA). MAIL_FROM·AWS_REGION은 api.env 값을 쓴다.
const { Client } = require('pg');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const send = process.argv.includes('--send');
const SUBJECT = '[바라 평생교육원] 개인정보처리방침·이용약관 게시 안내';
const TEXT = [
  '안녕하세요. 바라 평생교육원이에요.',
  '',
  '2026년 11월 27일 정식 오픈에 따라 개인정보처리방침·이용약관·환불정책을 v1.0으로 게시했어요.',
  '개인정보처리방침의 주요 내용은 11월 26일 게시본과 같아요. 표현을 일부 다듬고, 정식 오픈 전 방침을 요청하는 방법과 서비스 안내 메일 발송 위탁을 더했어요.',
  '이용약관은 시행일과 서비스 주소 표기(https://bara-edu.kr)를, 환불정책은 시행일만 바꿨어요.',
  '',
  '회원님이 가입하신 뒤 개인정보처리방침에서 바뀐 주요 내용',
  '- 서비스 서버와 데이터 보관을 Amazon Web Services(서울)로 옮겼어요.',
  '- 도형심리 자가진단의 응답과 결과는 민감정보로 보고, 별도로 동의를 받은 경우에만 처리해요.',
  '- 자가진단 민감정보 동의는 언제든 철회할 수 있어요. 마이페이지 [자가진단내역]에서 결과를 직접 삭제하면 돼요.',
  '- 회원이 탈퇴하면 자가진단 결과도 함께 삭제하고, 회원 계정에 연결되지 않은 결과는 90일 뒤 전체를 삭제해요.',
  '- 관리자 접속 기록을 2년 동안 보관해요.',
  '- 가입 인증·안내 메일 발송을 Amazon SES에 맡겨요.',
  '',
  '전문은 사이트 아래쪽 [개인정보처리방침]에서 볼 수 있어요: https://bara-edu.kr/legal/privacy',
  '정식 오픈 전에 게시했던 개인정보처리방침이 필요하시면 아래 연락처로 요청해 주세요.',
  '',
  '전화: 010-9025-5093',
  '이메일: info@ylia.io',
  '',
  '바라 평생교육원 (주식회사 일리아)',
  '',
].join('\n');

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const c = new Client({ connectionString: url, ssl: url.includes('sslmode') ? undefined : { rejectUnauthorized: false } });
  await c.connect();
  let to;
  try {
    await c.query('begin read only');
    await c.query('set local role bara_edu_service');
    to = (await c.query("select u.email from auth.users u join profiles p on p.id = u.id where p.role = 'learner' and p.status = 'active' and u.email is not null and u.email_confirmed_at is not null order by u.created_at")).rows.map((r) => r.email);
    await c.query('rollback');
  } finally {
    await c.end();
  }
  console.log(JSON.stringify({ mode: send ? 'send' : 'dry-run', recipients: to.length }));
  if (!send) return;
  // 받는 사람 수가 dry-run에서 확인한 수와 같을 때만 보낸다(개인정보 점검 권고). 예: --send --expect=5
  const expect = Number((process.argv.find((x) => x.startsWith('--expect=')) || '').slice('--expect='.length));
  if (!Number.isInteger(expect) || expect !== to.length) throw new Error(`--expect=<n> must equal recipients (${to.length})`);
  if (!process.env.MAIL_FROM) throw new Error('MAIL_FROM is not set');
  const ses = new SESv2Client({ region: process.env.AWS_REGION || 'ap-northeast-2' });
  let ok = 0;
  let failed = 0;
  for (const addr of to) {
    try {
      await ses.send(new SendEmailCommand({
        FromEmailAddress: process.env.MAIL_FROM,
        Destination: { ToAddresses: [addr] },
        Content: { Simple: { Subject: { Data: SUBJECT, Charset: 'UTF-8' }, Body: { Text: { Data: TEXT, Charset: 'UTF-8' } } } },
      }));
      ok++;
    } catch (err) {
      failed++;
      console.error('send failed:', err.name);
    }
  }
  console.log(JSON.stringify({ sent: ok, failed }));
  if (failed) process.exitCode = 1;
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
});
