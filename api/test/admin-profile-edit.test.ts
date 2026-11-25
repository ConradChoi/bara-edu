import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/mail/mailer.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/auth/sessions.js';
import { setupTestDb } from './helpers/db.js';

const KEY = 'k'.repeat(32);
let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: FastifyInstance;
let mailer: MemoryMailer;
let n = 0;
let adminId: string;
let adminToken: string;
let learnerToken: string;

beforeAll(async () => {
  ctx = await setupTestDb();
  mailer = new MemoryMailer();
  app = buildApp({ config: loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY }), pool: ctx.pool, mailer, storage: new MemoryStorage() });
  await app.ready();
  adminId = (await q("insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ('adm@example.com', now(), '{\"name\":\"관리자A\"}') returning id"))[0].id;
  await q(`begin; set local session_replication_role = replica; update profiles set role='admin' where id='${adminId}'; commit`);
  adminToken = (await createSession(ctx.pool, adminId, 30)).token;
  const l = (await q("insert into auth.users (email, email_confirmed_at) values ('lrn@example.com', now()) returning id"))[0].id;
  learnerToken = (await createSession(ctx.pool, l, 30)).token;
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

const q = async (sql: string, p: unknown[] = []) => (await ctx.adminPool.query(sql, p)).rows;
const tick = () => new Promise((r) => setTimeout(r, 30));

async function member(o: { name?: string; phone?: string | null; confirmed?: boolean; extraMeta?: object } = {}) {
  const email = `m${++n}@example.com`;
  const meta = { name: o.name ?? '홍길순', ...(o.phone === undefined ? { phone: '010-1111-2222' } : o.phone === null ? {} : { phone: o.phone }), ...(o.extraMeta ?? {}) };
  const id = (await q(`insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, ${o.confirmed === false ? 'null' : 'now()'}, $2) returning id`, [email, JSON.stringify(meta)]))[0].id as string;
  return { id, email };
}
const op = (name: string, params: object, token: string | undefined = adminToken, ip?: string) =>
  app.inject({
    method: 'POST', url: `/v1/op/${name}`,
    headers: { 'x-bara-service-key': KEY, ...(token ? { 'x-bara-session': token } : {}), ...(ip ? { 'x-bara-client-ip': ip } : {}) },
    payload: { params },
  });
const base = (memberId: string, over: object = {}) => ({
  memberId, name: '홍길동', expected: { name: '홍길순' }, reason: 'member_request', identityChecked: true, ...over,
});
const update = async (params: object, token?: string, ip?: string) => {
  const r = await op('admin.updateMemberProfile', params, token, ip);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().data;
};
const profile = async (id: string) => (await q('select name, phone, address, role, status, email from profiles where id = $1', [id]))[0];
const meta = async (id: string) => (await q('select raw_user_meta_data as m from auth.users where id = $1', [id]))[0].m;
const logs = (id: string) => q("select * from admin_access_logs where target_user_id = $1 and action = '정보수정' order by created_at", [id]);

test('이름 변경: profiles와 auth 메타를 함께 바꾸고 다른 메타 키는 보존, 전화는 그대로', async () => {
  const m = await member({ extraMeta: { keep: 1 } });
  const d = await update(base(m.id));
  expect(d).toEqual({ result: 'ok', changed: ['name'], profile: { name: '홍길동', phone: '010-1111-2222' }, mailQueued: true });
  expect((await profile(m.id)).name).toBe('홍길동');
  expect(await meta(m.id)).toEqual({ name: '홍길동', phone: '010-1111-2222', keep: 1 });
});

test('연락처 변경·비우기: 비우면 phone null, 메타 phone 키 삭제', async () => {
  const m = await member();
  let d = await update({ memberId: m.id, phone: ' +82 10-3333-4444 ', expected: { phone: '010-1111-2222' }, reason: 'typo_fix', identityChecked: true });
  expect(d.changed).toEqual(['phone']);
  expect((await profile(m.id)).phone).toBe('+82 10-3333-4444');
  d = await update({ memberId: m.id, phone: '  ', expected: { phone: '+82 10-3333-4444' }, reason: 'typo_fix', identityChecked: true });
  expect(d.profile.phone).toBeNull();
  expect((await profile(m.id)).phone).toBeNull();
  expect(await meta(m.id)).toEqual({ name: '홍길순' });
});

test('이름 가운데 공백은 한 칸으로 줄이고 앞뒤 공백은 지운다', async () => {
  const m = await member();
  const d = await update(base(m.id, { name: '  Ann   Lee ' }));
  expect(d.profile.name).toBe('Ann Lee');
});

test('주소·사진·역할·상태·이메일은 건드리지 않는다', async () => {
  const m = await member();
  await q("update profiles set address = '서울시' where id = $1", [m.id]);
  await update(base(m.id));
  const p = await profile(m.id);
  expect(p).toMatchObject({ address: '서울시', role: 'learner', status: 'active', email: m.email });
});

test('접속 기록: 같은 트랜잭션에서 1건, 항목·사유·본인확인만 남고 값은 없다', async () => {
  const m = await member({ name: '비밀이름', phone: '010-7777-8888' });
  await update({ memberId: m.id, name: '새이름', phone: '010-9999-0000', expected: { name: '비밀이름', phone: '010-7777-8888' }, reason: 'other', memo: '민원 접수 A12', identityChecked: true }, adminToken, '203.0.113.9');
  const rows = await logs(m.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ admin_id: adminId, target_user_id: m.id, action: '정보수정', ip_address: '203.0.113.9' });
  expect(rows[0].detail).toBe('fields=name,phone;reason=other;verified=email;memo=' + encodeURIComponent('민원 접수 A12'));
  for (const v of ['비밀이름', '새이름', '7777', '9999']) expect(rows[0].detail).not.toContain(v);
});

test('접속 기록 insert가 실패하면 변경 전체를 롤백하고 503 log_failed, 메일도 없다', async () => {
  const m = await member();
  await q(`create or replace function public.test_fail_log() returns trigger language plpgsql as $$ begin raise exception 'log down'; end $$`);
  await q("create trigger test_fail_log before insert on admin_access_logs for each row execute function public.test_fail_log()");
  try {
    const before = mailer.sent.length;
    const r = await op('admin.updateMemberProfile', base(m.id));
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toMatchObject({ code: 'unavailable', message: 'log_failed' });
    expect((await profile(m.id)).name).toBe('홍길순');
    expect((await meta(m.id)).name).toBe('홍길순');
    await tick();
    expect(mailer.sent.length).toBe(before);
  } finally {
    await q('drop trigger test_fail_log on admin_access_logs');
  }
});

test('변경 안내 메일: 가입 이메일로, 값 없이, 로그인 링크', async () => {
  const m = await member();
  const before = mailer.sent.length;
  await update(base(m.id, { phone: '010-0000-1111', expected: { name: '홍길순', phone: '010-1111-2222' } }));
  await tick();
  expect(mailer.sent).toHaveLength(before + 1);
  const msg = mailer.sent[before];
  expect(msg).toMatchObject({ to: m.email, template: 'profile_changed', fields: ['name', 'phone'] });
  expect(msg.link).toBeUndefined();
  expect(JSON.stringify(msg)).not.toContain('홍길동');
  expect(msg.at).toMatch(/^\d{4}년 \d{1,2}월 \d{1,2}일 (오전|오후) \d{1,2}시 \d{1,2}분$/);
});

test('메일 전송이 실패해도 변경은 성공이다', async () => {
  const failing = buildApp({ config: loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY }), pool: ctx.pool, mailer: { send: async () => { throw new Error('ses down'); } }, storage: new MemoryStorage() });
  await failing.ready();
  const m = await member();
  const r = await failing.inject({ method: 'POST', url: '/v1/op/admin.updateMemberProfile', headers: { 'x-bara-service-key': KEY, 'x-bara-session': adminToken }, payload: { params: base(m.id) } });
  expect(r.json().data.result).toBe('ok');
  await tick();
  expect((await profile(m.id)).name).toBe('홍길동');
  await failing.close();
});

test('메일 발송 실패 로그에는 template 이름이 들어가고 주소·내용은 없다', async () => {
  const lines: string[] = [];
  const failing = buildApp({
    config: loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY }), pool: ctx.pool, storage: new MemoryStorage(),
    mailer: { send: async () => { throw new Error('ses down to x@y.z'); } },
    logger: { level: 'info', stream: { write: (l: string) => void lines.push(l) } },
  });
  await failing.ready();
  const m = await member();
  await failing.inject({ method: 'POST', url: '/v1/op/admin.updateMemberProfile', headers: { 'x-bara-service-key': KEY, 'x-bara-session': adminToken }, payload: { params: base(m.id) } });
  await tick();
  const o = lines.map((l) => JSON.parse(l)).find((x) => x.msg === 'op mail failed');
  expect(o).toMatchObject({ template: 'profile_changed', errorName: 'Error' });
  expect(JSON.stringify(o)).not.toContain(m.email);
  expect(JSON.stringify(o)).not.toContain('x@y.z');
  await failing.close();
});

test('낙관적 잠금: expected가 다르면 stale과 현재 값, 아무것도 바뀌지 않고 기록·메일 없음', async () => {
  const m = await member();
  await q("update profiles set name = '다른관리자' where id = $1", [m.id]);
  const before = mailer.sent.length;
  const d = await update(base(m.id));
  expect(d).toEqual({ result: 'stale', current: { name: '다른관리자', phone: '010-1111-2222' } });
  expect((await profile(m.id)).name).toBe('다른관리자');
  expect(await logs(m.id)).toHaveLength(0);
  await tick();
  expect(mailer.sent).toHaveLength(before);
});

test('같은 요청 재시도: 현재 값이 요청 값과 같으면 unchanged, 기록·메일 중복 없음', async () => {
  const m = await member();
  await update(base(m.id));
  await tick();
  const before = mailer.sent.length;
  const d = await update(base(m.id));
  expect(d).toMatchObject({ result: 'unchanged', changed: [], profile: { name: '홍길동' } });
  expect(await logs(m.id)).toHaveLength(1);
  await tick();
  expect(mailer.sent).toHaveLength(before);
});

test('같은 요청 동시 2건: 한 건만 적용되고 기록은 1건', async () => {
  const m = await member();
  const [a, b] = await Promise.all([op('admin.updateMemberProfile', base(m.id)), op('admin.updateMemberProfile', base(m.id))]);
  const results = [a.json().data.result, b.json().data.result].sort();
  expect(results).toEqual(['ok', 'unchanged']);
  expect(await logs(m.id)).toHaveLength(1);
});

test('수정 불가 대상: 탈퇴, 가입 마무리 전, 관리자, 이메일 없음, 없는 회원', async () => {
  const w = await member();
  await q("update profiles set status = 'withdrawn' where id = $1", [w.id]);
  expect((await update(base(w.id))).result).toBe('withdrawn');
  const u = await member({ confirmed: false });
  expect((await update(base(u.id))).result).toBe('not_confirmed');
  expect((await update(base(adminId, { expected: { name: '관리자A' } }))).result).toBe('target_is_admin');
  const e = await member();
  await q(`begin; set local session_replication_role = replica; update profiles set email = null where id = '${e.id}'; commit`);
  expect((await update(base(e.id))).result).toBe('no_email');
  expect((await update(base('00000000-0000-4000-8000-000000000000'))).result).toBe('not_found');
  for (const id of [w.id, u.id, adminId, e.id]) expect(await logs(id)).toHaveLength(0);
  expect((await profile(u.id)).name).toBe('홍길순');
});

test('권한: 비관리자 forbidden(변경 없음), 세션 없으면 401', async () => {
  const m = await member();
  expect((await update(base(m.id), learnerToken)).result).toBe('forbidden');
  expect((await profile(m.id)).name).toBe('홍길순');
  expect((await op('admin.updateMemberProfile', base(m.id), '')).statusCode).toBe(401);
});

test('모양이 틀린 요청은 400: 모르는 키(role·email 등), 잘못된 uuid, expected 없음', async () => {
  const m = await member();
  for (const extra of [{ role: 'admin' }, { status: 'active' }, { email: 'x@y.z' }, { address: 'a' }, { photo_path: 'p' }, { origin: 'https://evil.test' }]) {
    expect((await op('admin.updateMemberProfile', base(m.id, extra))).statusCode, JSON.stringify(extra)).toBe(400);
  }
  expect((await op('admin.updateMemberProfile', base('nope'))).statusCode).toBe(400);
  const { expected: _e, ...noExpected } = base(m.id);
  expect((await op('admin.updateMemberProfile', noExpected)).statusCode).toBe(400);
  expect((await profile(m.id)).name).toBe('홍길순');
});

const invalid = async (over: object, field: string, reason: string) => {
  const m = await member();
  const d = await update(base(m.id, over));
  expect(d, JSON.stringify(over)).toEqual({ result: 'validation', field, reason });
  expect((await profile(m.id)).name).toBe('홍길순');
  expect(await logs(m.id)).toHaveLength(0);
};

test('이름 검증', async () => {
  await invalid({ name: '' }, 'name', 'name_length');
  await invalid({ name: ' 가 ' }, 'name', 'name_length');
  await invalid({ name: '가'.repeat(101) }, 'name', 'name_length');
  await invalid({ name: '홍\n길동' }, 'name', 'name_control');
  await invalid({ name: '홍\t길동' }, 'name', 'name_control');
  await invalid({ name: '탈퇴한 회원' }, 'name', 'name_reserved');
  const m = await member();
  expect((await update(base(m.id, { name: '😀😀' }))).result).toBe('ok'); // 이모지 2자(유니코드 문자 기준)
  expect((await update(base(m.id, { name: '가'.repeat(100), expected: { name: '😀😀' } }))).result).toBe('ok');
});

test('전화 검증', async () => {
  const ph = (phone: string) => ({ name: undefined, phone, expected: { phone: '010-1111-2222' } });
  await invalid(ph('123456'), 'phone', 'phone_length');
  await invalid(ph('1'.repeat(31)), 'phone', 'phone_length');
  await invalid(ph('010-abcd-5678'), 'phone', 'phone_chars');
  await invalid(ph('010-****-5678'), 'phone', 'phone_masked');
  await invalid(ph('+- ()  ++--'), 'phone', 'phone_digits');
});

test('사유·메모·본인 확인 검증', async () => {
  await invalid({ reason: undefined }, 'reason', 'reason_required');
  await invalid({ reason: 'whatever' }, 'reason', 'reason_required');
  await invalid({ identityChecked: false }, 'identityChecked', 'not_checked');
  await invalid({ reason: 'other' }, 'memo', 'memo_required');
  await invalid({ reason: 'other', memo: '짧음' }, 'memo', 'memo_required');
  await invalid({ memo: 'x'.repeat(101) }, 'memo', 'memo_length');
  await invalid({ memo: '번호 01012345678 입니다' }, 'memo', 'memo_has_pii');
  await invalid({ memo: '번호 010-1234-5678' }, 'memo', 'memo_has_pii');
  await invalid({ memo: '메일 a@b.co' }, 'memo', 'memo_has_pii');
  await invalid({ memo: '줄\n바꿈' }, 'memo', 'memo_has_pii');
  await invalid({ name: undefined, phone: undefined }, 'name', 'none');
  await invalid({ expected: {} }, 'expected', 'expected_missing');
});

test('메모: 날짜는 허용, 전화번호 형태는 거절', async () => {
  for (const ok of ['2026-11-26', '2026.11.26', '2026-11-26 요청', '2026-11-26 14:12', '2026.11.26 14:12', '2026/11/26 09:30 통화', '2026-11-26 2시', '접수 2026-11-26 3건', '접수번호 12345678', '전화로 요청하셔서 이름을 고쳤어요', '오기 정정']) {
    const m = await member();
    expect((await update(base(m.id, { memo: ok }))).result, ok).toBe('ok');
  }
  for (const no of ['010-1234-5678', '010 1234 5678', '010.1234.5678', '02-123-4567', '031-1234-5678', '01012345678', '1234567890 번', '900101-1234567', '+82 10-1234-5678', '+8210 1234 5678', '10-1234-5678', '０１０-１２３４-５６７８', '0 1 0 1 2 3 4 5 6 7 8', '110-123-456789', '(010) 1234 5678', 'abc @ naver.com', 'abc@naver.com', 'abc (at) naver.com', 'abc[at]naver.com', '짝\ud800없음', '2026-11-26 010-1234-5678', '14:12 01012345678']) {
    await invalid({ memo: no }, 'memo', 'memo_has_pii');
  }
});

test('바뀐 칸 판정: 기존 이름에 연속 공백이 있어도 phone만 보내면 이름은 후보가 아니다', async () => {
  const m = await member({ name: '홍  길동' });
  const d = await update({ memberId: m.id, phone: '010-5555-6666', expected: { phone: '010-1111-2222' }, reason: 'typo_fix', identityChecked: true });
  expect(d).toMatchObject({ result: 'ok', changed: ['phone'], profile: { name: '홍  길동', phone: '010-5555-6666' } });
  expect((await profile(m.id)).name).toBe('홍  길동');
  const [row] = await logs(m.id);
  expect(row.detail).toContain('fields=phone;');
  // 이름을 현재 원문 그대로 같이 보내도(바꾸지 않음) 검증·변경 대상이 아니다
  const d2 = await update({ memberId: m.id, name: '홍  길동', phone: '010-7777-8888', expected: { name: '홍  길동', phone: '010-5555-6666' }, reason: 'typo_fix', identityChecked: true });
  expect(d2).toMatchObject({ result: 'ok', changed: ['phone'] });
  expect((await profile(m.id)).name).toBe('홍  길동');
});

test('짝 없는 서로게이트 이름은 500이 아니라 name_control', async () => {
  await invalid({ name: '홍\ud800길동' }, 'name', 'name_control');
});

test('비관리자 호출은 서버 경고 로그를 남기고(개인정보 없음) forbidden', async () => {
  const lines: string[] = [];
  const logged = buildApp({
    config: loadConfig({ DATABASE_URL: 'postgresql://x/x', BARA_SERVICE_KEY: KEY }), pool: ctx.pool, mailer, storage: new MemoryStorage(),
    logger: { level: 'info', stream: { write: (l: string) => void lines.push(l) } },
  });
  await logged.ready();
  const m = await member();
  const r = await logged.inject({ method: 'POST', url: '/v1/op/admin.updateMemberProfile', headers: { 'x-bara-service-key': KEY, 'x-bara-session': learnerToken }, payload: { params: base(m.id) } });
  expect(r.json().data.result).toBe('forbidden');
  const warn = lines.map((l) => JSON.parse(l)).find((o) => o.msg === 'admin.updateMemberProfile forbidden');
  expect(warn).toMatchObject({ level: 40, op: 'admin.updateMemberProfile' });
  expect(JSON.stringify(warn)).not.toContain('홍길');
  await logged.close();
});

test('x-bara-client-ip가 IP 형식이 아니면 접속 기록 ip_address는 null', async () => {
  const a = await member();
  await update(base(a.id), adminToken, "1.2.3.4'; drop table x;--");
  expect((await logs(a.id))[0].ip_address).toBeNull();
  const b = await member();
  await update(base(b.id), adminToken, '2001:db8::1');
  expect((await logs(b.id))[0].ip_address).toBe('2001:db8::1');
});

test('메모의 구분자(; =)는 인코딩되어 detail 형식이 깨지지 않는다', async () => {
  const m = await member();
  await update(base(m.id, { memo: 'a=b;c' }));
  const [row] = await logs(m.id);
  expect(row.detail).toBe(`fields=name;reason=member_request;verified=email;memo=${encodeURIComponent('a=b;c')}`);
  expect(row.detail.split(';')).toHaveLength(4);
});

test('기존 값이 규칙에 어긋나도 바꾸지 않는 칸은 검증하지 않는다', async () => {
  const m = await member({ phone: '12' });
  const d = await update(base(m.id, { phone: '12', expected: { name: '홍길순', phone: '12' } }));
  expect(d).toMatchObject({ result: 'ok', changed: ['name'], profile: { phone: '12' } });
});

test('이력 조회: 최근 5건, 값 없음, 관리자 이름, hasMore', async () => {
  const m = await member();
  let cur = '홍길순';
  for (let i = 0; i < 6; i++) {
    const next = `이름${i}번`;
    await update(base(m.id, { name: next, expected: { name: cur }, reason: i === 5 ? 'other' : 'typo_fix', memo: i === 5 ? '메모 내용 입니다' : undefined }));
    cur = next;
  }
  const r = await op('admin.listMemberProfileEdits', { memberId: m.id });
  expect(r.statusCode, r.body).toBe(200);
  const d = r.json().data;
  expect(d.result).toBe('ok');
  expect(d.items).toHaveLength(5);
  expect(d.hasMore).toBe(true);
  expect(d.items[0]).toMatchObject({ adminName: '관리자A', fields: ['name'], reason: 'other', memo: '메모 내용 입니다' });
  expect(d.items[1]).toMatchObject({ reason: 'typo_fix', memo: null });
  expect(new Date(d.items[0].at).getTime()).toBeGreaterThanOrEqual(new Date(d.items[1].at).getTime());
  expect(JSON.stringify(d)).not.toContain('이름3번');
  const all = (await op('admin.listMemberProfileEdits', { memberId: m.id, limit: 50 })).json().data;
  expect(all.items).toHaveLength(6);
  expect(all.hasMore).toBe(false);
});

test('이력 조회: 다른 action(조회·수정)은 섞이지 않고, 비관리자 forbidden, 탈퇴한 관리자는 adminName null', async () => {
  const m = await member();
  await q("insert into admin_access_logs (admin_id, target_user_id, action, detail) values ($1, $2, '수정', '비밀번호 재설정 메일 발송'), ($1, $2, '조회', 'x')", [adminId, m.id]);
  expect((await op('admin.listMemberProfileEdits', { memberId: m.id })).json().data).toEqual({ result: 'ok', items: [], hasMore: false });
  expect((await op('admin.listMemberProfileEdits', { memberId: m.id }, learnerToken)).json().data.result).toBe('forbidden');
  expect((await op('admin.listMemberProfileEdits', { memberId: m.id }, '')).statusCode).toBe(401);
  expect((await op('admin.listMemberProfileEdits', { memberId: m.id, limit: 0 })).statusCode).toBe(400);
  const a2 = (await q("insert into auth.users (email, email_confirmed_at) values ('adm2@example.com', now()) returning id"))[0].id;
  await q(`begin; set local session_replication_role = replica; update profiles set role='admin' where id='${a2}'; commit`);
  const t2 = (await createSession(ctx.pool, a2, 30)).token;
  await update(base(m.id), t2);
  await q("update profiles set status = 'withdrawn' where id = $1", [a2]);
  const d = (await op('admin.listMemberProfileEdits', { memberId: m.id })).json().data;
  expect(d.items[0].adminName).toBeNull();
});
