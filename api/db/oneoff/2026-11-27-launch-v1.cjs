// 정식 오픈 1회용 스크립트 (2026-11-27). 근거: docs/01-plan/features/bara-edu-lms.launch-v1.md(대표 결정 D1~D3, 개인정보 점검 반영)
//
// 하는 일(한 트랜잭션):
//   1. 기대 건수 확인(다르면 롤백): 수료증 1, 강사과정 문의 1, privacy 10행(게시본 v10), terms 1행, refund-policy 1행, 활성 관리자 1, 보관 테이블 비어 있음
//   2. legal_documents 12행 전부를 archive.legal_documents_prelaunch로 복사(원래 값 그대로, archive_reason='launch_v1')
//   3. 수료증 1건·문의 1건 삭제, 행마다 admin_access_logs 1건(action '오픈전정리삭제', 이름·연락처·강좌명 없음)
//   4. privacy 10행 삭제 후 v1.0 본문을 version 1로 새로 넣어 게시(published_at·effective_at = 지금)
//   5. terms·refund-policy(version 1)는 본문(시행일·버전 표기)과 published_at·effective_at만 지금으로
//   6. 확인: 세 문서 모두 version 1 한 행·게시 상태, 본문이 v1.0 파일과 같음
// 자가진단 결과의 consent_privacy_doc_version(오픈 전 10)은 바꾸지 않는다(개인정보 점검 쟁점 2).
//
// 실행(WAS, api 폴더 안): node 2026-11-27-launch-v1.cjs <v1.0 본문 폴더>            → 확인만 하고 되돌림(기본)
//                        node 2026-11-27-launch-v1.cjs <v1.0 본문 폴더> --execute  → 반영
// 출력에는 건수와 행 id만 나온다(개인정보 없음).
// 11-27 17:08 운영 실행 완료. 보관 테이블 잠금 패치(2026-11-27-legal-prelaunch-archive-lock.sql) 뒤에는 보관 insert가 막혀 다시 실행할 수 없다.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const dir = process.argv[2];
const execute = process.argv.includes('--execute');
if (!dir) {
  console.error('usage: node 2026-11-27-launch-v1.cjs <dir with privacy.txt terms.txt refund-policy.txt> [--execute]');
  process.exit(2);
}
const body = (slug) => fs.readFileSync(path.join(dir, `${slug}.txt`), 'utf8');
const BODIES = { privacy: body('privacy'), terms: body('terms'), 'refund-policy': body('refund-policy') };
for (const [slug, text] of Object.entries(BODIES)) {
  if (!text.includes('버전: v1.0') || !text.includes('2026년 11월 27일')) throw new Error(`${slug}.txt is not the v1.0 body`);
}

const ACTION = '오픈전정리삭제';
const REASON = 'launch_cleanup';

function expectCount(label, rows, n) {
  if (rows.length !== n) throw new Error(`expected ${n} ${label}, found ${rows.length}`);
}

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const c = new Client({ connectionString: url, ssl: url.includes('sslmode') ? undefined : { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    await c.query('set local role bara_edu_service');
    await c.query("set local lock_timeout = '5s'");

    // 1. 기대 건수
    const certs = (await c.query('select id, user_id from certificates')).rows;
    expectCount('certificates', certs, 1);
    const leads = (await c.query('select l.id, coalesce(l.user_id, r.user_id) as user_id from diagnosis_leads l left join diagnosis_results r on r.id = l.result_id')).rows;
    expectCount('diagnosis_leads', leads, 1);
    const admins = (await c.query("select id from profiles where role = 'admin' and status = 'active'")).rows;
    expectCount('active admins', admins, 1);
    const docs = (await c.query('select id, slug, version, is_published from legal_documents order by slug, version')).rows;
    expectCount('legal_documents', docs, 12);
    const pub = docs.filter((d) => d.is_published).map((d) => `${d.slug}:${d.version}`).sort().join(',');
    if (pub !== 'privacy:10,refund-policy:1,terms:1') throw new Error(`unexpected published set ${pub}`);
    expectCount('privacy rows', docs.filter((d) => d.slug === 'privacy'), 10);
    const archived = (await c.query('select count(*)::int as n from archive.legal_documents_prelaunch')).rows[0].n;
    if (archived !== 0) throw new Error(`archive table is not empty (${archived})`);
    const consent10 = (await c.query('select count(*)::int as n from diagnosis_results where consent_privacy_doc_version = 10')).rows[0].n;
    const privacyTitle = (await c.query("select title, type::text as type from legal_documents where slug = 'privacy' and is_published")).rows[0];

    // 2. 원문 보관
    const a = await c.query(
      `insert into archive.legal_documents_prelaunch (id, type, slug, title, content, version, is_published, effective_at, created_at, published_at, archive_reason)
       select id, type::text, slug, title, content, version, is_published, effective_at, created_at, published_at, 'launch_v1' from legal_documents`,
    );
    if (a.rowCount !== 12) throw new Error(`archived ${a.rowCount}, expected 12`);

    // 3. 오픈 전 정리 삭제(대표 결정 D1) + 접속 기록
    const adminId = admins[0].id;
    const log = (target, table, id) =>
      c.query('insert into admin_access_logs (admin_id, target_user_id, action, detail, ip_address) values ($1, $2, $3, $4, null)', [
        adminId,
        target,
        ACTION,
        `by=db;operator=개발;reason=${REASON};table=${table};id=${id};fields=row`,
      ]);
    if ((await c.query('delete from certificates where id = $1', [certs[0].id])).rowCount !== 1) throw new Error('certificate delete');
    await log(certs[0].user_id, 'certificates', certs[0].id);
    if ((await c.query('delete from diagnosis_leads where id = $1', [leads[0].id])).rowCount !== 1) throw new Error('lead delete');
    await log(leads[0].user_id, 'diagnosis_leads', leads[0].id);

    // 4. 처리방침 v1.0 새로 시작(D2): 오픈 전 행은 보관했으므로 지우고 새 행을 게시
    const d = await c.query("delete from legal_documents where slug = 'privacy'");
    if (d.rowCount !== 10) throw new Error(`privacy delete ${d.rowCount}`);
    await c.query(
      `insert into legal_documents (type, slug, title, content, version, is_published, effective_at, published_at)
       values ($1::legal_doc_type, 'privacy', $2, $3, 1, true, now(), now())`,
      [privacyTitle.type, privacyTitle.title, BODIES.privacy],
    );

    // 5. 이용약관·환불정책 시행일 오늘(D3)
    for (const slug of ['terms', 'refund-policy']) {
      const u = await c.query('update legal_documents set content = $2, effective_at = now(), published_at = now() where slug = $1 and version = 1 and is_published', [slug, BODIES[slug]]);
      if (u.rowCount !== 1) throw new Error(`${slug} update ${u.rowCount}`);
    }

    // 6. 확인
    const after = (await c.query('select slug, version, is_published, content from legal_documents order by slug')).rows;
    expectCount('legal_documents after', after, 3);
    for (const row of after) {
      if (row.version !== 1 || !row.is_published || row.content !== BODIES[row.slug]) throw new Error(`verify ${row.slug}`);
    }
    const logs = (await c.query('select count(*)::int as n from admin_access_logs where action = $1', [ACTION])).rows[0].n;

    console.log(JSON.stringify({
      mode: execute ? 'execute' : 'dry-run',
      archived: a.rowCount,
      deleted: { certificates: certs[0].id, diagnosis_leads: leads[0].id },
      accessLogs: logs,
      legal: after.map((r) => `${r.slug}:v${r.version}.0`),
      diagnosisResultsConsentV10Kept: consent10,
    }));
    await c.query(execute ? 'commit' : 'rollback');
    console.log(execute ? 'COMMITTED' : 'ROLLED BACK (dry-run)');
  } catch (err) {
    await c.query('rollback').catch(() => {});
    console.error('FAILED, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
