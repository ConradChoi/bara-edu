// 정식 오픈 회원 안내 메일 1회 발송 (2026-11-27). 근거: 정식 오픈 계획 docs/01-plan/features/bara-edu-lms.launch-v1.md(개인정보 점검 4-3).
// 받는 사람: 활성 학습자(role=learner, status=active)의 가입 이메일. 관리자는 제외. 광고 아님(처리방침·약관 게시 안내).
// 실행(WAS, api 폴더 안): node 2026-11-27-launch-notice-mail.cjs            → 받을 사람 수만 출력(기본)
//                        node 2026-11-27-launch-notice-mail.cjs --send     → 한 명씩 따로 보냄(받는 사람끼리 주소가 보이지 않게)
// 출력에는 건수만 나온다(주소 없음). MAIL_FROM·AWS_REGION은 api.env 값을 쓴다.
const { Client } = require('pg');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const send = process.argv.includes('--send');
const SUBJECT = '[바라 평생교육원] 정식 오픈과 개인정보처리방침 안내';
const TEXT = [
  '안녕하세요. 바라 평생교육원이에요.',
  '',
  '바라 평생교육원이 2026년 11월 27일 정식으로 문을 열었어요. 먼저 가입해 주셔서 감사합니다.',
  '',
  '정식 오픈에 맞추어 개인정보처리방침·이용약관·환불정책을 v1.0으로 새로 게시했어요.',
  '개인정보처리방침의 내용은 11월 26일 게시본과 같고, 이용약관·환불정책은 시행일만 바뀌었어요.',
  '',
  '최근(2026년 11월) 개인정보처리방침에서 바뀐 주요 내용',
  '- 서비스 서버와 데이터 보관을 Amazon Web Services(서울)로 옮겼어요.',
  '- 도형심리 자가진단의 응답과 결과는 민감정보로 보고, 별도로 동의를 받은 경우에만 처리해요.',
  '- 관리자 접속 기록을 2년 동안 보관해요.',
  '',
  '전문은 사이트 아래쪽 [개인정보처리방침]에서 볼 수 있어요: https://bara-edu.kr/legal/privacy',
  '정식 오픈 전에 게시했던 개인정보처리방침이 필요하시면 아래 연락처로 요청해 주세요.',
  '',
  '전화: 010-9025-5093',
  '이메일: info@ylia.io',
  '',
  '바라 평생교육원',
  '',
].join('\n');

(async () => {
  const url = process.env.DATABASE_URL;
  const c = new Client({ connectionString: url, ssl: url.includes('sslmode') ? undefined : { rejectUnauthorized: false } });
  await c.connect();
  let to;
  try {
    await c.query('begin read only');
    await c.query('set local role bara_edu_service');
    to = (await c.query("select u.email from auth.users u join profiles p on p.id = u.id where p.role = 'learner' and p.status = 'active' and u.email is not null order by u.created_at")).rows.map((r) => r.email);
    await c.query('rollback');
  } finally {
    await c.end();
  }
  console.log(JSON.stringify({ mode: send ? 'send' : 'dry-run', recipients: to.length }));
  if (!send) return;
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
